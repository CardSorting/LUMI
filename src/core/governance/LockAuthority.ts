import { randomUUID } from "node:crypto"
import { acquireGovernedFileLock, recoverStaleGovernedFileLocks, releaseGovernedFileLock } from "@shared/governance/fileLock"
import { SwarmMutexService } from "@/core/swarm/SwarmMutexService"
import { getDb } from "@/infrastructure/db/Config"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import {
	acquireBroccoliFence,
	recoverStaleBroccoliFences,
	releaseBroccoliFence,
	verifyBroccoliFence,
} from "./BroccoliFencingAdapter"

export type LockFailureReason =
	| "collision"
	| "split_brain"
	| "stale_owner"
	| "duplicate_claim"
	| "owner_mismatch"
	| "fencing_mismatch"
	| "missing_fencing_token"
	| "durable_backend_unavailable"
	| "ambiguous_roadmap_admission"
	| "not_held"

export interface LockBackends {
	inProcess: boolean
	swarmMutex: boolean
	roadmapLease: boolean
	fileLock: boolean
	broccoliFence: boolean
}

export interface LockClaim {
	claimId: string
	resourceKey: string
	ownerId: string
	fencingToken: number
	roadmapLeaseTaskId?: string
	acquiredAt: number
	releasedAt?: number
	backends: LockBackends
}

export type LockAcquireResult = { ok: true; claim: LockClaim } | { ok: false; reason: LockFailureReason; error: string }

export type LockReleaseResult = { ok: true } | { ok: false; reason: LockFailureReason; error: string }

export interface StaleRecoveryReport {
	recovered: string[]
	errors: string[]
}

export interface LockAuthority {
	acquire(
		resourceKey: string,
		ownerId: string,
		options?: {
			workspace?: string
			roadmapLeaseTaskId?: string
			timeoutMs?: number
			roadmapEnabled?: boolean
			crossProcess?: boolean
			requireDurability?: boolean
		},
	): Promise<LockAcquireResult>
	release(claim: LockClaim): Promise<LockReleaseResult>
	verify(claim: LockClaim, workspace?: string): Promise<{ valid: boolean; reason?: LockFailureReason }>
	recoverStale(workspace: string, resourcePrefix?: string): Promise<StaleRecoveryReport>
}

function emptyBackends(): LockBackends {
	return { inProcess: false, swarmMutex: false, roadmapLease: false, fileLock: false, broccoliFence: false }
}

async function isSwarmMutexAvailable(): Promise<boolean> {
	try {
		await getDb()
		return true
	} catch {
		return false
	}
}

/**
 * Unified mutation-ownership authority — sole public claim/release path for governed lanes.
 * Layers: in-process registry → SwarmMutex → roadmap lease → file lock → broccoli fence.
 */
export class UnifiedLockAuthority implements LockAuthority {
	private static inProcessClaims = new Map<string, { ownerId: string; fencingToken: number; expiresAt: number }>()
	private static fencingCounter = 0

	async acquire(
		resourceKey: string,
		ownerId: string,
		options?: {
			workspace?: string
			roadmapLeaseTaskId?: string
			timeoutMs?: number
			roadmapEnabled?: boolean
			crossProcess?: boolean
			requireDurability?: boolean
		},
	): Promise<LockAcquireResult> {
		const timeoutMs = options?.timeoutMs ?? 300_000
		const crossProcess = options?.crossProcess ?? resourceKey.startsWith("governed-lane:")
		const requireDurability = options?.requireDurability ?? crossProcess
		const workspace = options?.workspace
		const backends = emptyBackends()

		const existing = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
		if (existing) {
			if (existing.expiresAt < Date.now()) {
				UnifiedLockAuthority.inProcessClaims.delete(resourceKey)
			} else if (existing.ownerId !== ownerId) {
				return { ok: false, reason: "collision", error: `Resource '${resourceKey}' held by '${existing.ownerId}'.` }
			}
		}

		if (options?.roadmapEnabled && options.roadmapLeaseTaskId && workspace) {
			try {
				const admission = await RoadmapService.getInstance().scheduleAdmission(
					workspace,
					ownerId,
					options.roadmapLeaseTaskId,
				)
				if (!admission.admitted) {
					return {
						ok: false,
						reason: "ambiguous_roadmap_admission",
						error: `Roadmap admission rejected (backoff ${admission.backoff_ms}ms).`,
					}
				}
				backends.roadmapLease = true
			} catch {
				return { ok: false, reason: "ambiguous_roadmap_admission", error: "Roadmap admission unavailable." }
			}
		}

		if (await isSwarmMutexAvailable()) {
			try {
				await SwarmMutexService.claim(resourceKey, ownerId, timeoutMs)
				backends.swarmMutex = true
			} catch (error) {
				return {
					ok: false,
					reason: "collision",
					error: error instanceof Error ? error.message : "Swarm mutex collision.",
				}
			}
		} else if (requireDurability) {
			return { ok: false, reason: "durable_backend_unavailable", error: "Swarm mutex unavailable." }
		}

		const fencingToken = ++UnifiedLockAuthority.fencingCounter

		if (crossProcess && workspace) {
			const fileResult = await acquireGovernedFileLock(workspace, resourceKey, ownerId, fencingToken, timeoutMs)
			if (!fileResult.ok) {
				await this.rollbackPartialAcquire(resourceKey, ownerId, backends, workspace)
				return { ok: false, reason: "collision", error: fileResult.error || "File lock collision." }
			}
			backends.fileLock = true

			const fenceResult = await acquireBroccoliFence(workspace, resourceKey, ownerId, fencingToken)
			if (!fenceResult.ok) {
				await releaseGovernedFileLock(workspace, resourceKey, ownerId).catch(() => undefined)
				await this.rollbackPartialAcquire(resourceKey, ownerId, backends, workspace)
				return { ok: false, reason: "split_brain", error: fenceResult.error }
			}
			backends.broccoliFence = true
		} else if (requireDurability && crossProcess && !workspace) {
			await this.rollbackPartialAcquire(resourceKey, ownerId, backends, workspace)
			return { ok: false, reason: "durable_backend_unavailable", error: "Workspace required for durable locks." }
		}

		const foreignInProcess = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
		if (foreignInProcess && foreignInProcess.ownerId !== ownerId && foreignInProcess.expiresAt >= Date.now()) {
			await this.rollbackPartialAcquire(resourceKey, ownerId, backends, workspace)
			return { ok: false, reason: "split_brain", error: `In-process split-brain on '${resourceKey}'.` }
		}

		UnifiedLockAuthority.inProcessClaims.set(resourceKey, {
			ownerId,
			fencingToken,
			expiresAt: Date.now() + timeoutMs,
		})
		backends.inProcess = true

		const claim: LockClaim = {
			claimId: randomUUID(),
			resourceKey,
			ownerId,
			fencingToken,
			roadmapLeaseTaskId: options?.roadmapLeaseTaskId,
			acquiredAt: Date.now(),
			backends,
		}

		return { ok: true, claim }
	}

	async release(claim: LockClaim): Promise<LockReleaseResult> {
		if (!claim.fencingToken) {
			return { ok: false, reason: "missing_fencing_token", error: "Claim missing fencing token." }
		}

		const current = UnifiedLockAuthority.inProcessClaims.get(claim.resourceKey)
		if (current && current.ownerId !== claim.ownerId) {
			return {
				ok: false,
				reason: "owner_mismatch",
				error: `Release owner mismatch: held by '${current.ownerId}', claim from '${claim.ownerId}'.`,
			}
		}
		if (current && current.fencingToken !== claim.fencingToken) {
			return { ok: false, reason: "fencing_mismatch", error: "Release fencing token mismatch." }
		}

		const errors: string[] = []

		if (claim.backends.swarmMutex) {
			try {
				await SwarmMutexService.release(claim.resourceKey, claim.ownerId)
			} catch {
				errors.push("Swarm mutex release rejected.")
			}
		}

		if (claim.backends.fileLock) {
			// workspace not stored on claim — caller must pass via resource key pattern or we skip
			// Governed lanes always release via coordinator which has workspace
		}

		if (current?.ownerId === claim.ownerId) {
			UnifiedLockAuthority.inProcessClaims.delete(claim.resourceKey)
		}

		claim.releasedAt = Date.now()

		if (errors.length > 0) {
			return { ok: false, reason: "owner_mismatch", error: errors.join(" ") }
		}
		return { ok: true }
	}

	async releaseWithWorkspace(claim: LockClaim, workspace: string): Promise<LockReleaseResult> {
		const base = await this.release(claim)
		if (!base.ok) {
			return base
		}

		if (claim.backends.broccoliFence) {
			const fenceResult = await releaseBroccoliFence(workspace, claim.resourceKey, claim.ownerId, claim.fencingToken)
			if (!fenceResult.ok) {
				return { ok: false, reason: "fencing_mismatch", error: fenceResult.error }
			}
		}

		if (claim.backends.fileLock) {
			await releaseGovernedFileLock(workspace, claim.resourceKey, claim.ownerId)
		}

		return { ok: true }
	}

	async verify(claim: LockClaim, workspace?: string): Promise<{ valid: boolean; reason?: LockFailureReason }> {
		const inProcess = UnifiedLockAuthority.inProcessClaims.get(claim.resourceKey)
		if (!inProcess || inProcess.ownerId !== claim.ownerId || inProcess.fencingToken !== claim.fencingToken) {
			return { valid: false, reason: "split_brain" }
		}

		if (claim.backends.broccoliFence && workspace) {
			const fence = await verifyBroccoliFence(workspace, claim.resourceKey, claim.ownerId, claim.fencingToken)
			if (!fence.valid) {
				return { valid: false, reason: fence.reason === "split_brain" ? "split_brain" : "stale_owner" }
			}
		}

		return { valid: true }
	}

	async recoverStale(workspace: string, resourcePrefix?: string): Promise<StaleRecoveryReport> {
		const recovered: string[] = []
		const errors: string[] = []
		const now = Date.now()

		for (const [resourceKey, claim] of UnifiedLockAuthority.inProcessClaims.entries()) {
			if (resourcePrefix && !resourceKey.startsWith(resourcePrefix)) {
				continue
			}
			if (claim.expiresAt < now) {
				UnifiedLockAuthority.inProcessClaims.delete(resourceKey)
				recovered.push(resourceKey)
			}
		}

		try {
			const fileRecovered = await recoverStaleGovernedFileLocks(workspace, resourcePrefix)
			recovered.push(...fileRecovered)
		} catch (error) {
			errors.push(`File lock recovery: ${error}`)
		}

		try {
			const fenceRecovered = await recoverStaleBroccoliFences(workspace, resourcePrefix)
			recovered.push(...fenceRecovered)
		} catch (error) {
			errors.push(`Broccoli fence recovery: ${error}`)
		}

		return { recovered: [...new Set(recovered)], errors }
	}

	private async rollbackPartialAcquire(
		resourceKey: string,
		ownerId: string,
		backends: LockBackends,
		_workspace?: string,
	): Promise<void> {
		if (backends.swarmMutex) {
			await SwarmMutexService.release(resourceKey, ownerId).catch(() => undefined)
		}
	}
}

/** Test-only authority without SQLite / roadmap dependencies. */
export class InMemoryLockAuthority implements LockAuthority {
	private static claims = new Map<string, LockClaim>()
	private static counter = 0

	async acquire(
		resourceKey: string,
		ownerId: string,
		_options?: { timeoutMs?: number; crossProcess?: boolean; requireDurability?: boolean },
	): Promise<LockAcquireResult> {
		const existing = InMemoryLockAuthority.claims.get(resourceKey)
		if (existing && !existing.releasedAt) {
			if (existing.ownerId === ownerId) {
				return { ok: true, claim: existing }
			}
			return { ok: false, reason: "collision", error: `Held by '${existing.ownerId}'.` }
		}

		const fencingToken = ++InMemoryLockAuthority.counter
		const claim: LockClaim = {
			claimId: randomUUID(),
			resourceKey,
			ownerId,
			fencingToken,
			acquiredAt: Date.now(),
			backends: { inProcess: true, swarmMutex: false, roadmapLease: false, fileLock: false, broccoliFence: false },
		}
		InMemoryLockAuthority.claims.set(resourceKey, claim)
		return { ok: true, claim }
	}

	async release(claim: LockClaim): Promise<LockReleaseResult> {
		if (!claim.fencingToken) {
			return { ok: false, reason: "missing_fencing_token", error: "Missing fencing token." }
		}
		const current = InMemoryLockAuthority.claims.get(claim.resourceKey)
		if (!current || current.releasedAt) {
			return { ok: false, reason: "not_held", error: `No active claim for '${claim.resourceKey}'.` }
		}
		if (current.ownerId !== claim.ownerId) {
			return { ok: false, reason: "owner_mismatch", error: `Expected '${current.ownerId}', got '${claim.ownerId}'.` }
		}
		if (current.fencingToken !== claim.fencingToken) {
			return { ok: false, reason: "fencing_mismatch", error: "Fencing token mismatch." }
		}
		current.releasedAt = Date.now()
		InMemoryLockAuthority.claims.delete(claim.resourceKey)
		return { ok: true }
	}

	async verify(claim: LockClaim): Promise<{ valid: boolean; reason?: LockFailureReason }> {
		const current = InMemoryLockAuthority.claims.get(claim.resourceKey)
		if (!current || current.ownerId !== claim.ownerId || current.fencingToken !== claim.fencingToken) {
			return { valid: false, reason: "split_brain" }
		}
		return { valid: true }
	}

	async recoverStale(_workspace: string, resourcePrefix?: string): Promise<StaleRecoveryReport> {
		const recovered: string[] = []
		const staleMs = 1
		const now = Date.now()
		for (const [key, claim] of InMemoryLockAuthority.claims.entries()) {
			if (resourcePrefix && !key.startsWith(resourcePrefix)) {
				continue
			}
			if (now - claim.acquiredAt > staleMs) {
				InMemoryLockAuthority.claims.delete(key)
				recovered.push(key)
			}
		}
		return { recovered, errors: [] }
	}

	static reset(): void {
		InMemoryLockAuthority.claims.clear()
		InMemoryLockAuthority.counter = 0
	}
}

export function createLockAuthority(options?: { inMemory?: boolean }): LockAuthority {
	return options?.inMemory ? new InMemoryLockAuthority() : new UnifiedLockAuthority()
}

/** Release with workspace-aware durable backends (file lock + broccoli fence). */
export async function releaseGovernedLock(
	authority: LockAuthority,
	claim: LockClaim,
	workspace: string,
): Promise<LockReleaseResult> {
	if (authority instanceof UnifiedLockAuthority) {
		return authority.releaseWithWorkspace(claim, workspace)
	}
	return authority.release(claim)
}
