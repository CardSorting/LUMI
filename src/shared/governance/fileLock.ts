import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { CoordinationAuthorityMode } from "./lockTypes"

export interface GovernedFileLockRecord {
	ownerId: string
	resourceKey: string
	claimedAt: number
	pid: number
	fencingToken: string
	leaseEpoch: string
	authorityMode: CoordinationAuthorityMode
	workspaceId: string
	swarmId: string
	laneId?: string
	expiresAt?: number
	heartbeatAt?: number
}

export interface FileLockCorruption {
	status: "corrupt"
	path: string
	reason: string
}

export type FileLockReadResult =
	| { status: "present"; path: string; record: GovernedFileLockRecord }
	| { status: "missing"; path: string }
	| FileLockCorruption

export interface StaleFileLockRecoveryResult {
	recovered: string[]
	corruptions: FileLockCorruption[]
}

const DEFAULT_STALE_MS = 600_000

export function governedLockPath(workspace: string, resourceKey: string): string {
	const lockDir = path.join(workspace, ".broccolidb", "governed", "locks")
	return path.join(lockDir, `${createHash("sha256").update(resourceKey).digest("hex")}.lock`)
}

function validateRecord(value: unknown, expectedResourceKey?: string): string | undefined {
	if (!value || typeof value !== "object") return "record_is_not_an_object"
	const record = value as Partial<GovernedFileLockRecord>
	if (typeof record.ownerId !== "string" || !record.ownerId) return "missing_or_invalid_ownerId"
	if (typeof record.resourceKey !== "string" || !record.resourceKey) return "missing_or_invalid_resourceKey"
	if (expectedResourceKey && record.resourceKey !== expectedResourceKey) return "resourceKey_mismatch"
	if (!Number.isFinite(record.claimedAt)) return "missing_or_invalid_claimedAt"
	if (!Number.isInteger(record.pid) || (record.pid ?? 0) < 1) return "missing_or_invalid_pid"
	if (typeof record.fencingToken !== "string" || !/^\d+$/.test(record.fencingToken)) {
		return "missing_or_invalid_fencingToken"
	}
	if (typeof record.leaseEpoch !== "string" || !/^\d+$/.test(record.leaseEpoch)) {
		return "missing_or_invalid_leaseEpoch"
	}
	if (record.authorityMode !== "sqlite" && record.authorityMode !== "local_test") {
		return "missing_or_invalid_authorityMode"
	}
	if (record.expiresAt !== undefined && !Number.isFinite(record.expiresAt)) return "invalid_expiresAt"
	if (record.heartbeatAt !== undefined && !Number.isFinite(record.heartbeatAt)) return "invalid_heartbeatAt"
	if (record.expiresAt !== undefined && record.expiresAt < (record.claimedAt as number)) {
		return "expiresAt_before_claimedAt"
	}
	return undefined
}

export async function readGovernedFileLock(workspace: string, resourceKey: string): Promise<FileLockReadResult> {
	const lockPath = governedLockPath(workspace, resourceKey)
	let raw: string
	try {
		raw = await fs.readFile(lockPath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", path: lockPath }
		return { status: "corrupt", path: lockPath, reason: `read_failed:${String(error)}` }
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return { status: "corrupt", path: lockPath, reason: "invalid_json" }
	}
	const reason = validateRecord(parsed, resourceKey)
	if (reason) return { status: "corrupt", path: lockPath, reason }
	return { status: "present", path: lockPath, record: parsed as GovernedFileLockRecord }
}

export async function acquireGovernedFileLock(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: string | number,
	leaseEpoch: string | number = "1",
	swarmId = "default",
	laneId?: string,
	staleMs = DEFAULT_STALE_MS,
	authorityMode: CoordinationAuthorityMode = "sqlite",
): Promise<{ ok: true } | { ok: false; reason: "collision" | "stale" | "corrupt" | "authority_mode_mismatch"; error: string }> {
	const lockPath = governedLockPath(workspace, resourceKey)
	await fs.mkdir(path.dirname(lockPath), { recursive: true })

	const claimedAt = Date.now()
	const record: GovernedFileLockRecord = {
		ownerId,
		resourceKey,
		claimedAt,
		pid: process.pid,
		fencingToken: String(fencingToken),
		leaseEpoch: String(leaseEpoch),
		authorityMode,
		workspaceId: workspace,
		swarmId,
		laneId,
		expiresAt: claimedAt + staleMs,
		heartbeatAt: claimedAt,
	}

	try {
		const handle = await fs.open(lockPath, "wx")
		try {
			await handle.writeFile(JSON.stringify(record), "utf8")
		} finally {
			await handle.close()
		}
		return { ok: true }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
	}

	const existing = await readGovernedFileLock(workspace, resourceKey)
	if (existing.status === "corrupt") {
		return { ok: false, reason: "corrupt", error: `Corrupt file lock '${existing.path}': ${existing.reason}.` }
	}
	if (existing.status === "missing") {
		return acquireGovernedFileLock(
			workspace,
			resourceKey,
			ownerId,
			fencingToken,
			leaseEpoch,
			swarmId,
			laneId,
			staleMs,
			authorityMode,
		)
	}
	if (existing.record.authorityMode !== authorityMode) {
		return {
			ok: false,
			reason: "authority_mode_mismatch",
			error: `File lock authority mode '${existing.record.authorityMode}' is incompatible with '${authorityMode}'.`,
		}
	}

	const referenceTime = existing.record.heartbeatAt ?? existing.record.claimedAt
	const isExpired =
		existing.record.expiresAt !== undefined ? Date.now() > existing.record.expiresAt : Date.now() > referenceTime + staleMs
	if (isExpired) {
		const released = await releaseGovernedFileLock(
			workspace,
			resourceKey,
			existing.record.ownerId,
			existing.record.leaseEpoch,
			existing.record.fencingToken,
			existing.record.authorityMode,
		)
		if (released.status !== "released") {
			return { ok: false, reason: "collision", error: `Expired file lock changed during reclamation.` }
		}
		return acquireGovernedFileLock(
			workspace,
			resourceKey,
			ownerId,
			fencingToken,
			leaseEpoch,
			swarmId,
			laneId,
			staleMs,
			authorityMode,
		)
	}
	if (
		existing.record.ownerId === ownerId &&
		existing.record.fencingToken === String(fencingToken) &&
		existing.record.leaseEpoch === String(leaseEpoch)
	) {
		return { ok: true }
	}
	return {
		ok: false,
		reason: "collision",
		error: `File lock held by '${existing.record.ownerId}' (token ${existing.record.fencingToken}, epoch ${existing.record.leaseEpoch}).`,
	}
}

export async function releaseGovernedFileLock(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	leaseEpoch?: string,
	fencingToken?: string,
	authorityMode?: CoordinationAuthorityMode,
): Promise<{ status: "released" | "not_owner" | "already_gone" | "corrupt"; released: boolean; error?: string }> {
	const existing = await readGovernedFileLock(workspace, resourceKey)
	if (existing.status === "missing") return { status: "already_gone", released: true }
	if (existing.status === "corrupt") {
		return { status: "corrupt", released: false, error: existing.reason }
	}
	const record = existing.record
	if (
		record.ownerId !== ownerId ||
		(leaseEpoch !== undefined && record.leaseEpoch !== leaseEpoch) ||
		(fencingToken !== undefined && record.fencingToken !== fencingToken) ||
		(authorityMode !== undefined && record.authorityMode !== authorityMode)
	) {
		return { status: "not_owner", released: false }
	}
	try {
		await fs.unlink(existing.path)
		return { status: "released", released: true }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "already_gone", released: true }
		return { status: "corrupt", released: false, error: String(error) }
	}
}

export async function recoverStaleGovernedFileLocksDetailed(
	workspace: string,
	resourcePrefix?: string,
	staleMs = DEFAULT_STALE_MS,
): Promise<StaleFileLockRecoveryResult> {
	const result: StaleFileLockRecoveryResult = { recovered: [], corruptions: [] }
	if (staleMs <= 0) return result
	const lockDir = path.join(workspace, ".broccolidb", "governed", "locks")
	let entries: string[]
	try {
		entries = await fs.readdir(lockDir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return result
		throw error
	}

	const now = Date.now()
	for (const entry of entries) {
		if (!entry.endsWith(".lock")) continue
		const lockPath = path.join(lockDir, entry)
		let raw: string
		try {
			raw = await fs.readFile(lockPath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				result.corruptions.push({ status: "corrupt", path: lockPath, reason: `read_failed:${String(error)}` })
			}
			continue
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			result.corruptions.push({ status: "corrupt", path: lockPath, reason: "invalid_json" })
			continue
		}
		const reason = validateRecord(parsed)
		if (reason) {
			result.corruptions.push({ status: "corrupt", path: lockPath, reason })
			continue
		}
		const record = parsed as GovernedFileLockRecord
		if (resourcePrefix && !record.resourceKey.startsWith(resourcePrefix)) continue
		const referenceTime = record.heartbeatAt ?? record.claimedAt
		const isExpired = record.expiresAt !== undefined ? now > record.expiresAt : now > referenceTime + staleMs
		if (!isExpired) continue
		const released = await releaseGovernedFileLock(
			workspace,
			record.resourceKey,
			record.ownerId,
			record.leaseEpoch,
			record.fencingToken,
			record.authorityMode,
		)
		if (released.status === "released") result.recovered.push(record.resourceKey)
		else if (released.status === "corrupt") {
			result.corruptions.push({ status: "corrupt", path: lockPath, reason: released.error ?? "release_failed" })
		}
	}
	return result
}

/** Compatibility wrapper for callers that only need recovered resource keys. */
export async function recoverStaleGovernedFileLocks(
	workspace: string,
	resourcePrefix?: string,
	staleMs = DEFAULT_STALE_MS,
): Promise<string[]> {
	return (await recoverStaleGovernedFileLocksDetailed(workspace, resourcePrefix, staleMs)).recovered
}

export async function verifyGovernedFileLock(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: string,
	leaseEpoch?: string,
	authorityMode: CoordinationAuthorityMode = "sqlite",
): Promise<{ valid: boolean; reason?: string }> {
	const result = await readGovernedFileLock(workspace, resourceKey)
	if (result.status === "missing") return { valid: false, reason: "orphaned" }
	if (result.status === "corrupt") return { valid: false, reason: "corrupt" }
	const record = result.record
	if (record.authorityMode !== authorityMode) return { valid: false, reason: "authority_mode_mismatch" }
	if (record.ownerId !== ownerId) return { valid: false, reason: "split_brain" }
	if (record.fencingToken !== fencingToken || (leaseEpoch !== undefined && record.leaseEpoch !== leaseEpoch)) {
		return { valid: false, reason: "stale" }
	}
	return { valid: true }
}
