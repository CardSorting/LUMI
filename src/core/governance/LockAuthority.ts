import { randomUUID } from "node:crypto"
import { CoordinationError, CoordinationErrorCode } from "@shared/governance/CoordinationErrors"
import {
	acquireGovernedFileLock,
	readGovernedFileLock,
	releaseGovernedFileLock,
	verifyGovernedFileLock,
} from "@shared/governance/fileLock"
import type { CoordinationAuthorityMode, LockBackends, LockClaim } from "@shared/governance/lockTypes"
import { Logger } from "@shared/services/Logger"
import { type DurableSwarmLease, SwarmMutexService } from "@/core/swarm/SwarmMutexService"
import { getCoordinationDb } from "@/infrastructure/db/Config"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { acquireBroccoliFence, readBroccoliFence, releaseBroccoliFence, verifyBroccoliFence } from "./BroccoliFencingAdapter"

export type { CoordinationAuthorityMode, LockBackends, LockClaim } from "@shared/governance/lockTypes"

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
	| "authority_mode_mismatch"
	| "coordination_state_corrupt"
	| "not_held"

export type LockAcquireResult =
	| { ok: true; claim: LockClaim }
	| {
			ok: false
			reason: LockFailureReason
			error: string
			code?: CoordinationErrorCode
			retryClass?: "retry" | "reconcile_then_retry" | "abort_owner" | "fail_closed"
	  }

export type LockReleaseResult = { ok: true } | { ok: false; reason: LockFailureReason; error: string }

export interface StaleRecoveryReport {
	recovered: string[]
	errors: string[]
}

export interface SwarmLeaseIdentity {
	workspaceId: string
	swarmId: string
	laneId?: string
	ownerId: string
	leaseEpoch: string
	fencingToken: string
}

export type ReconciliationStatus =
	| "retain"
	| "repair_projection"
	| "reclaim"
	| "already_released"
	| "fail_closed"
	| "expired_owner_reclaimed"
	| "ownership_conflict"
	| "active_owner_retained"

export interface ReconciliationRepair {
	backend: "memory" | "database" | "filesystem" | "broccoli"
	action: "write" | "delete"
}

export interface LeaseReconciliationResult {
	resourceKey: string
	status: ReconciliationStatus
	previousOwner?: SwarmLeaseIdentity
	currentOwner?: SwarmLeaseIdentity
	reason: string
}

export interface LeaseObservation {
	ownerId: string
	leaseEpoch: string
	fencingToken: string
	expiresAt: number
	pid?: number
	authorityMode: CoordinationAuthorityMode
}

export interface ReconciliationSnapshot {
	memory?: LeaseObservation
	database?: LeaseObservation
	filesystem?: LeaseObservation
	broccoli?: LeaseObservation
	observedAt: number
	dbAvailable: boolean
	corruptions?: string[]
}

export interface ReconciliationDecision {
	status: ReconciliationStatus
	authoritativeLease?: LeaseObservation
	repairs: ReconciliationRepair[]
	reason: string
}

export interface LockAuthority {
	readonly authorityMode: CoordinationAuthorityMode
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
	release(claim: LockClaim, workspace?: string): Promise<LockReleaseResult>
	verify(claim: LockClaim, workspace?: string): Promise<{ valid: boolean; reason?: LockFailureReason }>
	recoverStale(workspace: string, resourcePrefix?: string): Promise<StaleRecoveryReport>
	reconcileSwarmLease(
		workspace: string,
		swarmId: string,
		laneCount: number,
		requestorOwnerId: string,
		expectedLeaseEpoch?: string,
		fencingToken?: string,
	): Promise<LeaseReconciliationResult[]>
	assertCurrentFencingToken(resourceKey: string, suppliedToken: string, workspace?: string): Promise<void>
}

type InProcessLease = LeaseObservation

function emptyBackends(): LockBackends {
	return { inProcess: false, swarmMutex: false, roadmapLease: false, fileLock: false, broccoliFence: false }
}

function resolveStartupCoordinationAuthorityMode(): CoordinationAuthorityMode {
	const explicit = process.env.LUMI_COORDINATION_AUTHORITY_MODE
	if (explicit === "sqlite" || explicit === "local_test") return explicit
	if (process.env.LUMI_LOCAL_ONLY === "true" || process.env.TS_NODE_PROJECT?.includes("unit-test")) return "local_test"
	return "sqlite"
}

/** Immutable process-start authority selection. It is never recomputed after module initialization. */
export const COORDINATION_AUTHORITY_MODE: CoordinationAuthorityMode = resolveStartupCoordinationAuthorityMode()

export function configuredCoordinationAuthorityMode(): CoordinationAuthorityMode {
	return COORDINATION_AUTHORITY_MODE
}

/** @deprecated Prefer the immutable authorityMode property on a LockAuthority instance. */
export function isLocalOnlyMode(): boolean {
	return configuredCoordinationAuthorityMode() === "local_test"
}

export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

export function mapLockFailureReasonToCode(reason: string): CoordinationErrorCode {
	switch (reason) {
		case "collision":
		case "duplicate_claim":
			return CoordinationErrorCode.LOCK_BUSY
		case "split_brain":
			return CoordinationErrorCode.SPLIT_BRAIN_DETECTED
		case "stale_owner":
			return CoordinationErrorCode.LEASE_EXPIRED
		case "owner_mismatch":
			return CoordinationErrorCode.OWNERSHIP_CHANGED
		case "fencing_mismatch":
			return CoordinationErrorCode.FENCING_TOKEN_REJECTED
		case "ambiguous_roadmap_admission":
			return CoordinationErrorCode.OWNERSHIP_AMBIGUOUS
		case "authority_mode_mismatch":
			return CoordinationErrorCode.AUTHORITY_MODE_MISMATCH
		case "not_held":
			return CoordinationErrorCode.LOCK_RELEASE_FAILED
		case "durable_backend_unavailable":
			return CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE
		default:
			return CoordinationErrorCode.COORDINATION_STATE_CORRUPT
	}
}

function sameIdentity(left: LeaseObservation, right: LeaseObservation): boolean {
	return (
		left.ownerId === right.ownerId &&
		left.leaseEpoch === right.leaseEpoch &&
		left.fencingToken === right.fencingToken &&
		left.authorityMode === right.authorityMode
	)
}

function compareProjection(projection: LeaseObservation, database: LeaseObservation): "same" | "older" | "newer" | "corrupt" {
	if (projection.authorityMode !== database.authorityMode) return "corrupt"
	const projectionToken = BigInt(projection.fencingToken)
	const databaseToken = BigInt(database.fencingToken)
	if (projectionToken < databaseToken) return "older"
	if (projectionToken > databaseToken) return "newer"
	return sameIdentity(projection, database) ? "same" : "corrupt"
}

export function decideReconciliation(
	snapshot: ReconciliationSnapshot,
	_requestorOwnerId: string,
	now: number,
): ReconciliationDecision {
	if (!snapshot.dbAvailable) {
		return {
			status: "fail_closed",
			repairs: [],
			reason: "SQLite authority is unavailable; no lease or projection may be reclaimed.",
		}
	}
	if (snapshot.corruptions?.length) {
		return { status: "fail_closed", repairs: [], reason: `Corrupt coordination records: ${snapshot.corruptions.join("; ")}` }
	}

	const database = snapshot.database
	const projections: Array<[ReconciliationRepair["backend"], LeaseObservation | undefined]> = [
		["memory", snapshot.memory],
		["filesystem", snapshot.filesystem],
		["broccoli", snapshot.broccoli],
	]
	if (!database) {
		const repairs = projections
			.filter(([, projection]) => projection !== undefined)
			.map(([backend]) => ({ backend, action: "delete" as const }))
		return repairs.length
			? { status: "reclaim", repairs, reason: "Orphaned projections exist without an authoritative SQLite lease." }
			: { status: "already_released", repairs: [], reason: "Lease is already fully released." }
	}
	if (database.authorityMode !== "sqlite") {
		return { status: "fail_closed", repairs: [], reason: `Incompatible database authority mode '${database.authorityMode}'.` }
	}
	if (now > database.expiresAt) {
		return {
			status: "reclaim",
			authoritativeLease: database,
			repairs: [
				{ backend: "database", action: "delete" },
				...projections.filter(([, value]) => value).map(([backend]) => ({ backend, action: "delete" as const })),
			],
			reason: "Authoritative SQLite lease expired.",
		}
	}

	const repairs: ReconciliationRepair[] = []
	for (const [backend, projection] of projections) {
		if (!projection) {
			repairs.push({ backend, action: "write" })
			continue
		}
		const comparison = compareProjection(projection, database)
		if (comparison === "newer" || comparison === "corrupt") {
			return {
				status: "fail_closed",
				repairs: [],
				reason: `${backend} projection has ${comparison} identity relative to SQLite.`,
			}
		}
		if (comparison === "older") repairs.push({ backend, action: "write" })
	}
	return repairs.length
		? {
				status: "repair_projection",
				authoritativeLease: database,
				repairs,
				reason: "Missing or stale projections must be repaired from SQLite.",
			}
		: { status: "retain", authoritativeLease: database, repairs: [], reason: "Active SQLite lease is consistent." }
}

function observationFromDurableLease(lease: DurableSwarmLease): LeaseObservation {
	return {
		ownerId: lease.ownerId,
		leaseEpoch: lease.leaseEpoch,
		fencingToken: lease.fencingToken,
		expiresAt: lease.expiresAt,
		pid: lease.pid,
		authorityMode: lease.authorityMode,
	}
}

function databaseFailure(error: unknown, operation: string): CoordinationError {
	if (error instanceof CoordinationError) return error
	return new CoordinationError(
		CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
		`SQLite coordination authority unavailable during ${operation}.`,
		"retry",
		undefined,
		error,
	)
}

/** Unified production authority. SQLite is authoritative; memory and files are projections only. */
export class UnifiedLockAuthority implements LockAuthority {
	static readonly inProcessClaims = new Map<string, InProcessLease>()

	constructor(public readonly authorityMode: CoordinationAuthorityMode = configuredCoordinationAuthorityMode()) {}

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
		if (this.authorityMode === "local_test") return this.acquireLocal(resourceKey, ownerId, options)

		const timeoutMs = options?.timeoutMs ?? 300_000
		const crossProcess = options?.crossProcess ?? resourceKey.startsWith("governed-lane:")
		const requireDurability = options?.requireDurability ?? crossProcess
		const workspace = options?.workspace
		const backends = emptyBackends()

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
			} catch (error) {
				return { ok: false, reason: "ambiguous_roadmap_admission", error: String(error) }
			}
		}

		if (requireDurability && crossProcess && !workspace) {
			return { ok: false, reason: "durable_backend_unavailable", error: "Workspace required for durable projections." }
		}

		let lease: DurableSwarmLease
		try {
			lease = await SwarmMutexService.acquireLease(resourceKey, ownerId, timeoutMs)
			backends.swarmMutex = true
		} catch (error) {
			const coordination = databaseFailure(error, "acquisition")
			const collision = coordination.code === CoordinationErrorCode.LOCK_BUSY
			return {
				ok: false,
				reason: collision
					? "collision"
					: coordination.code === CoordinationErrorCode.AUTHORITY_MODE_MISMATCH
						? "authority_mode_mismatch"
						: coordination.code === CoordinationErrorCode.COORDINATION_STATE_CORRUPT
							? "coordination_state_corrupt"
							: "durable_backend_unavailable",
				error: coordination.message,
				code: coordination.code,
				retryClass: coordination.retryClass,
			}
		}

		const projectionErrors: string[] = []
		if (crossProcess && workspace) {
			const [swarmId = "default", laneId] = resourceKey.split(":").slice(1)
			try {
				const file = await acquireGovernedFileLock(
					workspace,
					resourceKey,
					ownerId,
					lease.fencingToken,
					lease.leaseEpoch,
					swarmId,
					laneId,
					timeoutMs,
					this.authorityMode,
				)
				if (!file.ok) projectionErrors.push(file.error)
				else backends.fileLock = true
			} catch (error) {
				projectionErrors.push(`File projection failed: ${String(error)}`)
			}

			if (projectionErrors.length === 0) {
				try {
					const broccoli = await acquireBroccoliFence(
						workspace,
						resourceKey,
						ownerId,
						lease.fencingToken,
						lease.leaseEpoch,
						swarmId,
						laneId,
						this.authorityMode,
					)
					if (!broccoli.ok) projectionErrors.push(broccoli.error)
					else backends.broccoliFence = true
				} catch (error) {
					projectionErrors.push(`Broccoli projection failed: ${String(error)}`)
				}
			}
		}

		const currentMemory = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
		if (currentMemory && !sameIdentity(currentMemory, observationFromDurableLease(lease))) {
			projectionErrors.push("In-process projection contains a different lease identity.")
		}

		if (projectionErrors.length > 0) {
			await this.abandonLeaseAfterProjectionFailure(lease, workspace, backends)
			return { ok: false, reason: "split_brain", error: projectionErrors.join(" ") }
		}

		UnifiedLockAuthority.inProcessClaims.set(resourceKey, observationFromDurableLease(lease))
		backends.inProcess = true
		return {
			ok: true,
			claim: {
				claimId: randomUUID(),
				resourceKey,
				ownerId,
				fencingToken: lease.fencingToken,
				leaseEpoch: lease.leaseEpoch,
				authorityMode: this.authorityMode,
				roadmapLeaseTaskId: options?.roadmapLeaseTaskId,
				acquiredAt: lease.createdAt,
				backends,
			},
		}
	}

	async release(claim: LockClaim, workspace?: string): Promise<LockReleaseResult> {
		if (!claim.fencingToken || !claim.leaseEpoch) {
			return { ok: false, reason: "missing_fencing_token", error: "Claim missing lease identity." }
		}
		if (claim.authorityMode !== this.authorityMode) {
			return { ok: false, reason: "authority_mode_mismatch", error: "Claim authority mode is incompatible." }
		}
		if (this.authorityMode === "local_test") return this.releaseLocal(claim)

		let releaseResult: Awaited<ReturnType<typeof SwarmMutexService.release>>
		try {
			releaseResult = await SwarmMutexService.release(
				claim.resourceKey,
				claim.ownerId,
				claim.leaseEpoch,
				claim.fencingToken,
			)
		} catch (error) {
			const coordination = databaseFailure(error, "release")
			return { ok: false, reason: "durable_backend_unavailable", error: coordination.message }
		}
		if (releaseResult.status === "not_owner") {
			return { ok: false, reason: "owner_mismatch", error: "SQLite lease identity changed before release." }
		}

		const cleanupErrors: string[] = []
		const memory = UnifiedLockAuthority.inProcessClaims.get(claim.resourceKey)
		if (memory) {
			if (
				memory.ownerId === claim.ownerId &&
				memory.leaseEpoch === claim.leaseEpoch &&
				memory.fencingToken === claim.fencingToken &&
				memory.authorityMode === claim.authorityMode
			)
				UnifiedLockAuthority.inProcessClaims.delete(claim.resourceKey)
			else cleanupErrors.push("In-process projection identity changed.")
		}
		if (workspace && claim.backends.fileLock) {
			const file = await releaseGovernedFileLock(
				workspace,
				claim.resourceKey,
				claim.ownerId,
				claim.leaseEpoch,
				claim.fencingToken,
				claim.authorityMode,
			)
			if (file.status === "not_owner" || file.status === "corrupt") cleanupErrors.push(`File projection: ${file.status}`)
		}
		if (workspace && claim.backends.broccoliFence) {
			const broccoli = await releaseBroccoliFence(
				workspace,
				claim.resourceKey,
				claim.ownerId,
				claim.fencingToken,
				claim.leaseEpoch,
				claim.authorityMode,
			)
			if (!broccoli.ok) cleanupErrors.push(broccoli.error)
		}
		claim.releasedAt = Date.now()
		if (cleanupErrors.length) {
			Logger.warn(`[LockAuthority] SQLite release committed; projection cleanup failures: ${cleanupErrors.join("; ")}`)
		}
		return { ok: true }
	}

	async verify(claim: LockClaim, workspace?: string): Promise<{ valid: boolean; reason?: LockFailureReason }> {
		if (claim.authorityMode !== this.authorityMode) return { valid: false, reason: "authority_mode_mismatch" }
		if (this.authorityMode === "local_test") {
			const current = UnifiedLockAuthority.inProcessClaims.get(claim.resourceKey)
			return current && current.ownerId === claim.ownerId && current.fencingToken === claim.fencingToken
				? { valid: true }
				: { valid: false, reason: "split_brain" }
		}

		let lease: DurableSwarmLease | undefined
		try {
			lease = await SwarmMutexService.getLease(claim.resourceKey)
		} catch {
			return { valid: false, reason: "durable_backend_unavailable" }
		}
		if (!lease || lease.expiresAt < Date.now()) return { valid: false, reason: "stale_owner" }
		if (lease.ownerId !== claim.ownerId || lease.leaseEpoch !== claim.leaseEpoch || lease.fencingToken !== claim.fencingToken)
			return { valid: false, reason: "split_brain" }
		const memory = UnifiedLockAuthority.inProcessClaims.get(claim.resourceKey)
		if (memory && !sameIdentity(memory, observationFromDurableLease(lease))) return { valid: false, reason: "split_brain" }
		if (claim.backends.fileLock && workspace) {
			const file = await verifyGovernedFileLock(
				workspace,
				claim.resourceKey,
				claim.ownerId,
				claim.fencingToken,
				claim.leaseEpoch,
				claim.authorityMode,
			)
			if (!file.valid) return { valid: false, reason: file.reason === "stale" ? "stale_owner" : "split_brain" }
		}
		if (claim.backends.broccoliFence && workspace) {
			const broccoli = await verifyBroccoliFence(
				workspace,
				claim.resourceKey,
				claim.ownerId,
				claim.fencingToken,
				claim.leaseEpoch,
				claim.authorityMode,
			)
			if (!broccoli.valid) return { valid: false, reason: broccoli.reason === "stale" ? "stale_owner" : "split_brain" }
		}
		return { valid: true }
	}

	async recoverStale(_workspace: string, _resourcePrefix?: string): Promise<StaleRecoveryReport> {
		if (this.authorityMode === "local_test") {
			const recovered: string[] = []
			for (const [key, claim] of UnifiedLockAuthority.inProcessClaims) {
				if (claim.authorityMode === "local_test" && claim.expiresAt < Date.now()) {
					UnifiedLockAuthority.inProcessClaims.delete(key)
					recovered.push(key)
				}
			}
			return { recovered, errors: [] }
		}
		try {
			await getCoordinationDb()
			return { recovered: [], errors: [] }
		} catch (error) {
			throw databaseFailure(error, "stale recovery")
		}
	}

	async reconcileSwarmLease(
		workspace: string,
		swarmId: string,
		laneCount: number,
		requestorOwnerId: string,
		_expectedLeaseEpoch?: string,
		_fencingToken?: string,
	): Promise<LeaseReconciliationResult[]> {
		if (this.authorityMode === "local_test") {
			return Array.from({ length: laneCount }, (_, index) => {
				const resourceKey = `governed-lane:${swarmId}:${index}`
				const claim = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
				return claim
					? {
							resourceKey,
							status: "active_owner_retained" as const,
							reason: `Local-test lease retained for '${claim.ownerId}'.`,
						}
					: { resourceKey, status: "already_released" as const, reason: "No local-test lease." }
			})
		}

		try {
			await getCoordinationDb()
		} catch (error) {
			throw databaseFailure(error, "reconciliation snapshot")
		}

		const results: LeaseReconciliationResult[] = []
		for (let index = 0; index < laneCount; index++) {
			const resourceKey = `governed-lane:${swarmId}:${index}`
			let durable: DurableSwarmLease | undefined
			try {
				durable = await SwarmMutexService.getLease(resourceKey)
			} catch (error) {
				throw databaseFailure(error, "reconciliation lease read")
			}
			const database = durable ? observationFromDurableLease(durable) : undefined
			const memory = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
			const corruptions: string[] = []

			const fileRead = await readGovernedFileLock(workspace, resourceKey)
			let filesystem: LeaseObservation | undefined
			if (fileRead.status === "corrupt") corruptions.push(`filesystem:${fileRead.reason}`)
			else if (fileRead.status === "present") {
				filesystem = {
					ownerId: fileRead.record.ownerId,
					leaseEpoch: fileRead.record.leaseEpoch,
					fencingToken: fileRead.record.fencingToken,
					expiresAt: fileRead.record.expiresAt ?? fileRead.record.claimedAt,
					pid: fileRead.record.pid,
					authorityMode: fileRead.record.authorityMode,
				}
			}

			const broccoliRead = await readBroccoliFence(workspace, resourceKey)
			let broccoli: LeaseObservation | undefined
			if (broccoliRead.status === "corrupt") corruptions.push(`broccoli:${broccoliRead.reason}`)
			else if (broccoliRead.status === "present") {
				broccoli = {
					ownerId: broccoliRead.record.ownerId,
					leaseEpoch: broccoliRead.record.leaseEpoch,
					fencingToken: broccoliRead.record.fencingToken,
					expiresAt: broccoliRead.record.expiresAt,
					pid: broccoliRead.record.pid,
					authorityMode: broccoliRead.record.authorityMode,
				}
			}

			const snapshot: ReconciliationSnapshot = {
				memory,
				database,
				filesystem,
				broccoli,
				observedAt: Date.now(),
				dbAvailable: true,
				corruptions,
			}
			const decision = decideReconciliation(snapshot, requestorOwnerId, snapshot.observedAt)
			if (decision.status === "fail_closed") {
				results.push({ resourceKey, status: "fail_closed", reason: decision.reason })
				continue
			}

			if (decision.status === "reclaim") {
				if (database) {
					const released = await SwarmMutexService.release(
						resourceKey,
						database.ownerId,
						database.leaseEpoch,
						database.fencingToken,
					)
					if (released.status === "not_owner") {
						results.push({
							resourceKey,
							status: "ownership_conflict",
							reason: "SQLite lease changed after snapshot.",
						})
						continue
					}
				}
				const cleanupErrors = await this.cleanObservedProjections(workspace, resourceKey, memory, filesystem, broccoli)
				results.push({
					resourceKey,
					status: cleanupErrors.length ? "ownership_conflict" : "expired_owner_reclaimed",
					reason: cleanupErrors.length ? cleanupErrors.join("; ") : decision.reason,
				})
				continue
			}

			if (decision.status === "repair_projection" && database) {
				const errors = await this.repairProjections(
					workspace,
					resourceKey,
					swarmId,
					String(index),
					database,
					snapshot,
					decision.repairs,
				)
				results.push({
					resourceKey,
					status: errors.length ? "fail_closed" : "repair_projection",
					reason: errors.length ? errors.join("; ") : decision.reason,
				})
				continue
			}

			results.push({
				resourceKey,
				status: decision.status === "retain" ? "active_owner_retained" : "already_released",
				reason: decision.reason,
			})
		}
		return results
	}

	async assertCurrentFencingToken(resourceKey: string, suppliedToken: string, workspace?: string): Promise<void> {
		if (!/^\d+$/.test(suppliedToken)) {
			throw new CoordinationError(
				CoordinationErrorCode.FENCING_TOKEN_REJECTED,
				"Fencing token is malformed.",
				"abort_owner",
			)
		}
		if (this.authorityMode === "local_test") {
			const current = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
			if (!current || current.fencingToken !== suppliedToken || current.authorityMode !== "local_test") {
				throw new CoordinationError(
					CoordinationErrorCode.FENCING_TOKEN_REJECTED,
					"Fencing token is not the current local-test token.",
					"abort_owner",
				)
			}
			return
		}

		let lease: DurableSwarmLease | undefined
		try {
			lease = await SwarmMutexService.getLease(resourceKey)
		} catch (error) {
			throw databaseFailure(error, "fencing validation")
		}
		if (!lease || lease.fencingToken !== suppliedToken || lease.expiresAt < Date.now()) {
			throw new CoordinationError(
				CoordinationErrorCode.FENCING_TOKEN_REJECTED,
				`Fencing token '${suppliedToken}' is not the current live SQLite token for '${resourceKey}'.`,
				"abort_owner",
			)
		}
		if (workspace) {
			const file = await readGovernedFileLock(workspace, resourceKey)
			if (
				file.status === "corrupt" ||
				(file.status === "present" && BigInt(file.record.fencingToken) > BigInt(suppliedToken))
			) {
				throw new CoordinationError(
					CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
					`Filesystem projection is corrupt or newer than SQLite for '${resourceKey}'.`,
					"fail_closed",
				)
			}
		}
	}

	private async acquireLocal(
		resourceKey: string,
		ownerId: string,
		options?: { timeoutMs?: number; crossProcess?: boolean; requireDurability?: boolean; roadmapLeaseTaskId?: string },
	): Promise<LockAcquireResult> {
		const existing = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
		if (existing && existing.expiresAt > Date.now()) {
			return { ok: false, reason: "collision", error: `Resource '${resourceKey}' is held by '${existing.ownerId}'.` }
		}
		const token = InMemoryLockAuthority.nextToken()
		const observation: LeaseObservation = {
			ownerId,
			leaseEpoch: token,
			fencingToken: token,
			expiresAt: Date.now() + (options?.timeoutMs ?? 300_000),
			pid: process.pid,
			authorityMode: "local_test",
		}
		UnifiedLockAuthority.inProcessClaims.set(resourceKey, observation)
		return {
			ok: true,
			claim: {
				claimId: randomUUID(),
				resourceKey,
				ownerId,
				fencingToken: token,
				leaseEpoch: token,
				authorityMode: "local_test",
				roadmapLeaseTaskId: options?.roadmapLeaseTaskId,
				acquiredAt: Date.now(),
				backends: { inProcess: true, swarmMutex: false, roadmapLease: false, fileLock: false, broccoliFence: false },
			},
		}
	}

	private async releaseLocal(claim: LockClaim): Promise<LockReleaseResult> {
		const current = UnifiedLockAuthority.inProcessClaims.get(claim.resourceKey)
		if (!current) return { ok: false, reason: "not_held", error: "No active local-test lease." }
		if (current.ownerId !== claim.ownerId) {
			return { ok: false, reason: "owner_mismatch", error: "Local-test lease owner changed." }
		}
		if (current.leaseEpoch !== claim.leaseEpoch || current.fencingToken !== claim.fencingToken) {
			return { ok: false, reason: "fencing_mismatch", error: "Local-test lease generation changed." }
		}
		UnifiedLockAuthority.inProcessClaims.delete(claim.resourceKey)
		claim.releasedAt = Date.now()
		return { ok: true }
	}

	private async abandonLeaseAfterProjectionFailure(
		lease: DurableSwarmLease,
		workspace: string | undefined,
		backends: LockBackends,
	): Promise<void> {
		if (workspace && backends.broccoliFence) {
			await releaseBroccoliFence(
				workspace,
				lease.resource,
				lease.ownerId,
				lease.fencingToken,
				lease.leaseEpoch,
				lease.authorityMode,
			).catch(() => undefined)
		}
		if (workspace && backends.fileLock) {
			await releaseGovernedFileLock(
				workspace,
				lease.resource,
				lease.ownerId,
				lease.leaseEpoch,
				lease.fencingToken,
				lease.authorityMode,
			).catch(() => undefined)
		}
		try {
			const released = await SwarmMutexService.release(lease.resource, lease.ownerId, lease.leaseEpoch, lease.fencingToken)
			if (released.status === "not_owner")
				Logger.error(`[LockAuthority] Failed to abandon lease '${lease.resource}': identity changed.`)
		} catch (error) {
			Logger.error(`[LockAuthority] Failed to abandon lease '${lease.resource}' after projection failure.`, error)
		}
	}

	private async cleanObservedProjections(
		workspace: string,
		resourceKey: string,
		memory?: LeaseObservation,
		filesystem?: LeaseObservation,
		broccoli?: LeaseObservation,
	): Promise<string[]> {
		const errors: string[] = []
		if (memory) {
			const current = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
			if (current && sameIdentity(current, memory)) UnifiedLockAuthority.inProcessClaims.delete(resourceKey)
			else if (current) errors.push("Memory projection changed after snapshot.")
		}
		if (filesystem) {
			const result = await releaseGovernedFileLock(
				workspace,
				resourceKey,
				filesystem.ownerId,
				filesystem.leaseEpoch,
				filesystem.fencingToken,
				filesystem.authorityMode,
			)
			if (result.status === "not_owner" || result.status === "corrupt") errors.push(`Filesystem cleanup: ${result.status}`)
		}
		if (broccoli) {
			const result = await releaseBroccoliFence(
				workspace,
				resourceKey,
				broccoli.ownerId,
				broccoli.fencingToken,
				broccoli.leaseEpoch,
				broccoli.authorityMode,
			)
			if (!result.ok) errors.push(`Broccoli cleanup: ${result.error}`)
		}
		return errors
	}

	private async repairProjections(
		workspace: string,
		resourceKey: string,
		swarmId: string,
		laneId: string,
		authoritative: LeaseObservation,
		snapshot: ReconciliationSnapshot,
		repairs: ReconciliationRepair[],
	): Promise<string[]> {
		const errors: string[] = []
		for (const repair of repairs) {
			if (repair.backend === "memory") {
				const current = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
				if (current && snapshot.memory && !sameIdentity(current, snapshot.memory)) {
					errors.push("Memory projection changed during repair.")
					continue
				}
				UnifiedLockAuthority.inProcessClaims.set(resourceKey, { ...authoritative })
			}
			if (repair.backend === "filesystem") {
				if (snapshot.filesystem) {
					const removed = await releaseGovernedFileLock(
						workspace,
						resourceKey,
						snapshot.filesystem.ownerId,
						snapshot.filesystem.leaseEpoch,
						snapshot.filesystem.fencingToken,
						snapshot.filesystem.authorityMode,
					)
					if (removed.status === "not_owner" || removed.status === "corrupt") {
						errors.push(`Filesystem projection changed during repair (${removed.status}).`)
						continue
					}
				}
				const written = await acquireGovernedFileLock(
					workspace,
					resourceKey,
					authoritative.ownerId,
					authoritative.fencingToken,
					authoritative.leaseEpoch,
					swarmId,
					laneId,
					Math.max(1, authoritative.expiresAt - Date.now()),
					authoritative.authorityMode,
				)
				if (!written.ok) errors.push(written.error)
			}
			if (repair.backend === "broccoli") {
				if (snapshot.broccoli) {
					const removed = await releaseBroccoliFence(
						workspace,
						resourceKey,
						snapshot.broccoli.ownerId,
						snapshot.broccoli.fencingToken,
						snapshot.broccoli.leaseEpoch,
						snapshot.broccoli.authorityMode,
					)
					if (!removed.ok) {
						errors.push(removed.error)
						continue
					}
				}
				const written = await acquireBroccoliFence(
					workspace,
					resourceKey,
					authoritative.ownerId,
					authoritative.fencingToken,
					authoritative.leaseEpoch,
					swarmId,
					laneId,
					authoritative.authorityMode,
				)
				if (!written.ok) errors.push(written.error)
			}
		}
		return errors
	}
}

/** Test-only authority without SQLite or filesystem projections. */
export class InMemoryLockAuthority implements LockAuthority {
	readonly authorityMode = "local_test" as const
	private readonly delegate = new UnifiedLockAuthority("local_test")
	private static counter = 0n

	static nextToken(): string {
		InMemoryLockAuthority.counter += 1n
		return InMemoryLockAuthority.counter.toString()
	}

	acquire(...args: Parameters<LockAuthority["acquire"]>): ReturnType<LockAuthority["acquire"]> {
		return this.delegate.acquire(...args)
	}
	release(...args: Parameters<LockAuthority["release"]>): ReturnType<LockAuthority["release"]> {
		return this.delegate.release(...args)
	}
	verify(...args: Parameters<LockAuthority["verify"]>): ReturnType<LockAuthority["verify"]> {
		return this.delegate.verify(...args)
	}
	recoverStale(...args: Parameters<LockAuthority["recoverStale"]>): ReturnType<LockAuthority["recoverStale"]> {
		return this.delegate.recoverStale(...args)
	}
	reconcileSwarmLease(
		...args: Parameters<LockAuthority["reconcileSwarmLease"]>
	): ReturnType<LockAuthority["reconcileSwarmLease"]> {
		return this.delegate.reconcileSwarmLease(...args)
	}
	assertCurrentFencingToken(
		...args: Parameters<LockAuthority["assertCurrentFencingToken"]>
	): ReturnType<LockAuthority["assertCurrentFencingToken"]> {
		return this.delegate.assertCurrentFencingToken(...args)
	}

	static reset(): void {
		for (const [key, claim] of UnifiedLockAuthority.inProcessClaims) {
			if (claim.authorityMode === "local_test") UnifiedLockAuthority.inProcessClaims.delete(key)
		}
		InMemoryLockAuthority.counter = 0n
	}
}

export function createLockAuthority(options?: { inMemory?: boolean; mode?: CoordinationAuthorityMode }): LockAuthority {
	const mode = options?.mode ?? (options?.inMemory ? "local_test" : configuredCoordinationAuthorityMode())
	return mode === "local_test" ? new InMemoryLockAuthority() : new UnifiedLockAuthority("sqlite")
}

export async function releaseGovernedLock(
	authority: LockAuthority,
	claim: LockClaim,
	workspace: string,
): Promise<LockReleaseResult> {
	return authority.release(claim, workspace)
}
