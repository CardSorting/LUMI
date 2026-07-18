import * as fs from "node:fs/promises"
import { governedLockPath } from "@shared/governance/fileLock"
import { Logger } from "@shared/services/Logger"
import { getCoordinationDb } from "@/infrastructure/db/Config"
import { broccoliFencePath } from "./BroccoliFencingAdapter"
import { COORDINATION_AUTHORITY_MODE, UnifiedLockAuthority } from "./LockAuthority"

export interface AdministrativeCleanupRecord {
	backend: "database" | "memory" | "filesystem" | "broccoli"
	resourceKey: string
	ownerId?: string
	leaseEpoch?: string
	fencingToken?: string
}

export class AdministrativeLockCleaner {
	/**
	 * Forcefully cleans and releases locks matching a swarm's lane indices.
	 * This is an administrative-only panic cleanup utility.
	 * @param workspace Workspace path
	 * @param swarmId Swarm ID to target
	 * @param laneCount Number of lanes in the swarm
	 * @param overrideReason Explicit reason for manual/administrative override
	 */
	static async forceReleaseSwarm(
		workspace: string,
		swarmId: string,
		laneCount: number,
		overrideReason: string,
	): Promise<AdministrativeCleanupRecord[]> {
		if (!overrideReason.trim()) {
			throw new Error("Administrative lock cleanup requires an explicit ownership override reason.")
		}
		const removed: AdministrativeCleanupRecord[] = []
		Logger.info(
			`[AdminLockCleaner] Executing administrative force release for swarmId=${swarmId} with laneCount=${laneCount}. Override reason: "${overrideReason}"`,
		)

		for (let index = 0; index < laneCount; index++) {
			const resourceKey = `governed-lane:${swarmId}:${index}`

			// 1. Clean SQLite DB if active
			if (COORDINATION_AUTHORITY_MODE === "sqlite") {
				try {
					const db = await getCoordinationDb()
					const existing = await db
						.selectFrom("swarm_locks")
						.select(["ownerId", "leaseEpoch", "fencingToken"])
						.where("resource", "=", resourceKey)
						.executeTakeFirst()

					if (existing) {
						Logger.info(
							`[AdminLockCleaner] Removing DB lock for resource=${resourceKey} held by ownerId=${existing.ownerId}`,
						)
						await db.deleteFrom("swarm_locks").where("resource", "=", resourceKey).execute()
						removed.push({
							backend: "database",
							resourceKey,
							ownerId: existing.ownerId,
							leaseEpoch: existing.leaseEpoch,
							fencingToken: existing.fencingToken,
						})
					}
				} catch (err) {
					Logger.error(`[AdminLockCleaner] Failed to release DB lock for resource=${resourceKey}:`, err)
				}
			}

			// 2. Clean memory claims
			const inProcess = UnifiedLockAuthority.inProcessClaims.get(resourceKey)
			if (inProcess) {
				Logger.info(
					`[AdminLockCleaner] Removing memory claim for resource=${resourceKey} held by ownerId=${inProcess.ownerId}`,
				)
				UnifiedLockAuthority.inProcessClaims.delete(resourceKey)
				removed.push({
					backend: "memory",
					resourceKey,
					ownerId: inProcess.ownerId,
					leaseEpoch: inProcess.leaseEpoch,
					fencingToken: inProcess.fencingToken,
				})
			}

			// 3. Clean filesystem locks
			try {
				const lockPath = governedLockPath(workspace, resourceKey)
				const content = await fs.readFile(lockPath, "utf8").catch(() => undefined)
				if (content) {
					const record = JSON.parse(content)
					Logger.info(
						`[AdminLockCleaner] Removing file lock at ${lockPath} for resource=${resourceKey} held by ownerId=${record.ownerId}`,
					)
					await fs.unlink(lockPath)
					removed.push({
						backend: "filesystem",
						resourceKey,
						ownerId: record.ownerId,
						leaseEpoch: record.leaseEpoch,
						fencingToken: record.fencingToken,
					})
				}
			} catch {}

			// 4. Clean broccoli fences
			try {
				const fenceFile = broccoliFencePath(workspace, resourceKey)
				const content = await fs.readFile(fenceFile, "utf8").catch(() => undefined)
				if (content) {
					const record = JSON.parse(content)
					Logger.info(
						`[AdminLockCleaner] Removing broccoli fence at ${fenceFile} for resource=${resourceKey} held by ownerId=${record.ownerId}`,
					)
					await fs.unlink(fenceFile)
					removed.push({
						backend: "broccoli",
						resourceKey,
						ownerId: record.ownerId,
						leaseEpoch: record.leaseEpoch,
						fencingToken: record.fencingToken,
					})
				}
			} catch {}
		}
		return removed
	}
}
