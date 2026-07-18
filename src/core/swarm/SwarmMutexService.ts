import { CoordinationError, CoordinationErrorCode } from "@shared/governance/CoordinationErrors"
import type { CoordinationAuthorityMode } from "@shared/governance/lockTypes"
import { getCoordinationRawDb } from "../../infrastructure/db/Config"

export const SWARM_LOCK_PROTOCOL_VERSION = 2

export interface DurableSwarmLease {
	resource: string
	ownerId: string
	expiresAt: number
	createdAt: number
	leaseEpoch: string
	fencingToken: string
	protocolVersion: number
	authorityMode: CoordinationAuthorityMode
	pid: number
}

type RawDatabase = Awaited<ReturnType<typeof getCoordinationRawDb>>

function asDatabaseUnavailable(error: unknown, operation: string): CoordinationError {
	if (error instanceof CoordinationError) return error
	return new CoordinationError(
		CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
		`SQLite authority unavailable during ${operation}.`,
		"retry",
		undefined,
		error,
	)
}

function parseCounter(value: unknown, field: string): bigint {
	if (typeof value !== "string" || !/^\d+$/.test(value)) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Invalid ${field} value in swarm lock generation state.`,
			"fail_closed",
		)
	}
	return BigInt(value)
}

function normalizeLease(row: Record<string, unknown>): DurableSwarmLease {
	if (
		typeof row.resource !== "string" ||
		typeof row.ownerId !== "string" ||
		typeof row.leaseEpoch !== "string" ||
		!/^\d+$/.test(row.leaseEpoch) ||
		typeof row.fencingToken !== "string" ||
		!/^\d+$/.test(row.fencingToken) ||
		row.authorityMode !== "sqlite" ||
		Number(row.protocolVersion) !== SWARM_LOCK_PROTOCOL_VERSION ||
		!Number.isFinite(Number(row.expiresAt)) ||
		!Number.isFinite(Number(row.createdAt)) ||
		!Number.isInteger(Number(row.pid))
	) {
		throw new CoordinationError(
			row.authorityMode && row.authorityMode !== "sqlite"
				? CoordinationErrorCode.AUTHORITY_MODE_MISMATCH
				: CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Swarm lease '${String(row.resource)}' uses incompatible or corrupt coordination metadata.`,
			"fail_closed",
		)
	}
	return {
		resource: row.resource,
		ownerId: row.ownerId,
		expiresAt: Number(row.expiresAt),
		createdAt: Number(row.createdAt),
		leaseEpoch: row.leaseEpoch,
		fencingToken: row.fencingToken,
		protocolVersion: Number(row.protocolVersion),
		authorityMode: "sqlite",
		pid: Number(row.pid),
	}
}

function withImmediateTransaction<T>(rawDb: RawDatabase, operation: () => T): T {
	rawDb.exec("BEGIN IMMEDIATE")
	try {
		const result = operation()
		rawDb.exec("COMMIT")
		return result
	} catch (error) {
		try {
			rawDb.exec("ROLLBACK")
		} catch {}
		throw error
	}
}

/** SQLite-backed lease authority. All generation allocation and lease changes are CAS transactions. */
export class SwarmMutexService {
	static async acquireLease(key: string, ownerId: string, timeoutMs = 300_000): Promise<DurableSwarmLease> {
		let rawDb: RawDatabase
		try {
			rawDb = await getCoordinationRawDb()
		} catch (error) {
			throw asDatabaseUnavailable(error, "lease acquisition")
		}

		try {
			return withImmediateTransaction(rawDb, () => {
				const now = Date.now()
				const existingRaw = rawDb.prepare("SELECT * FROM swarm_locks WHERE resource = ?").get(key) as
					| Record<string, unknown>
					| undefined
				let existing: DurableSwarmLease | undefined
				if (existingRaw) {
					existing = normalizeLease(existingRaw)
					if (existing.expiresAt > now) {
						throw new CoordinationError(
							CoordinationErrorCode.LOCK_BUSY,
							`Resource '${key}' is already claimed by '${existing.ownerId}'.`,
							"retry",
							{ ownerId: existing.ownerId, expiresAt: existing.expiresAt },
						)
					}
				}

				rawDb
					.prepare(
						"INSERT OR IGNORE INTO swarm_lock_generations (resourceKey, highestLeaseEpoch, highestFencingToken) VALUES (?, '0', '0')",
					)
					.run(key)
				const generation = rawDb
					.prepare("SELECT highestLeaseEpoch, highestFencingToken FROM swarm_lock_generations WHERE resourceKey = ?")
					.get(key) as Record<string, unknown> | undefined
				if (!generation) {
					throw new CoordinationError(
						CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
						`Missing generation state for '${key}'.`,
						"fail_closed",
					)
				}
				const currentEpoch = parseCounter(generation.highestLeaseEpoch, "highestLeaseEpoch")
				const currentToken = parseCounter(generation.highestFencingToken, "highestFencingToken")
				const previousEpoch = existing ? BigInt(existing.leaseEpoch) : 0n
				const previousToken = existing ? BigInt(existing.fencingToken) : 0n
				const leaseEpoch = (currentEpoch > previousEpoch ? currentEpoch : previousEpoch) + 1n
				const fencingToken = (currentToken > previousToken ? currentToken : previousToken) + 1n
				const expiresAt = now + timeoutMs

				rawDb
					.prepare(
						"UPDATE swarm_lock_generations SET highestLeaseEpoch = ?, highestFencingToken = ? WHERE resourceKey = ?",
					)
					.run(leaseEpoch.toString(), fencingToken.toString(), key)
				rawDb
					.prepare(
						`INSERT INTO swarm_locks (
							resource, ownerId, expiresAt, createdAt, leaseEpoch, fencingToken, protocolVersion, authorityMode, pid
						) VALUES (?, ?, ?, ?, ?, ?, ?, 'sqlite', ?)
						ON CONFLICT(resource) DO UPDATE SET
							ownerId = excluded.ownerId,
							expiresAt = excluded.expiresAt,
							createdAt = excluded.createdAt,
							leaseEpoch = excluded.leaseEpoch,
							fencingToken = excluded.fencingToken,
							protocolVersion = excluded.protocolVersion,
							authorityMode = excluded.authorityMode,
							pid = excluded.pid`,
					)
					.run(
						key,
						ownerId,
						expiresAt,
						now,
						leaseEpoch.toString(),
						fencingToken.toString(),
						SWARM_LOCK_PROTOCOL_VERSION,
						process.pid,
					)

				return {
					resource: key,
					ownerId,
					expiresAt,
					createdAt: now,
					leaseEpoch: leaseEpoch.toString(),
					fencingToken: fencingToken.toString(),
					protocolVersion: SWARM_LOCK_PROTOCOL_VERSION,
					authorityMode: "sqlite",
					pid: process.pid,
				}
			})
		} catch (error) {
			if (error instanceof CoordinationError) throw error
			throw asDatabaseUnavailable(error, "lease acquisition")
		}
	}

	/** Compatibility helper. New code should retain the returned identity from acquireLease. */
	static async claim(key: string, ownerId: string, timeoutMs = 300_000): Promise<void> {
		await SwarmMutexService.acquireLease(key, ownerId, timeoutMs)
	}

	static async getLease(key: string): Promise<DurableSwarmLease | undefined> {
		try {
			const rawDb = await getCoordinationRawDb()
			const row = rawDb.prepare("SELECT * FROM swarm_locks WHERE resource = ?").get(key) as
				| Record<string, unknown>
				| undefined
			return row ? normalizeLease(row) : undefined
		} catch (error) {
			if (error instanceof CoordinationError) throw error
			throw asDatabaseUnavailable(error, "lease read")
		}
	}

	static async release(
		key: string,
		ownerId: string,
		leaseEpoch: string | bigint,
		fencingToken: string | bigint,
	): Promise<{ status: "released" | "not_owner" | "already_gone"; released: boolean }> {
		try {
			const rawDb = await getCoordinationRawDb()
			return withImmediateTransaction(rawDb, () => {
				const deletion = rawDb
					.prepare(
						`DELETE FROM swarm_locks
						 WHERE resource = ? AND ownerId = ? AND leaseEpoch = ? AND fencingToken = ? AND authorityMode = 'sqlite'`,
					)
					.run(key, ownerId, String(leaseEpoch), String(fencingToken))
				if (deletion.changes === 1) return { status: "released", released: true }
				const exists = rawDb.prepare("SELECT 1 FROM swarm_locks WHERE resource = ?").get(key)
				return exists ? { status: "not_owner", released: false } : { status: "already_gone", released: true }
			})
		} catch (error) {
			if (error instanceof CoordinationError) throw error
			throw asDatabaseUnavailable(error, "lease release")
		}
	}

	static async pruneStaleLocks(): Promise<void> {
		try {
			const rawDb = await getCoordinationRawDb()
			withImmediateTransaction(rawDb, () => {
				rawDb.prepare("DELETE FROM swarm_locks WHERE expiresAt < ? AND authorityMode = 'sqlite'").run(Date.now())
			})
		} catch (error) {
			throw asDatabaseUnavailable(error, "stale lease pruning")
		}
	}

	static async runExclusive<T>(key: string, ownerId: string, fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
		const lease = await SwarmMutexService.acquireLease(key, ownerId, timeoutMs)
		try {
			return await fn()
		} finally {
			await SwarmMutexService.release(key, ownerId, lease.leaseEpoch, lease.fencingToken)
		}
	}
}
