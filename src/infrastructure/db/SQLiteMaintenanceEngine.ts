import { CompiledQuery } from "kysely"
import { Logger } from "@/shared/services/Logger"
import { getDb, getDbStorageMetrics, getRawDb } from "./Config"
import { isSqlitePersistenceBypassed } from "./sqlitePersistence"

export interface RetentionPolicy {
	/** Max age in milliseconds for telemetry rows (default: 30 days) */
	telemetryMaxAgeMs?: number
	/** Max rows to retain in telemetry (default: 25000) */
	telemetryMaxRows?: number
	/** Max age in milliseconds for audit_events (default: 30 days) */
	auditMaxAgeMs?: number
	/** Max rows to retain in audit_events (default: 25000) */
	auditMaxRows?: number
	/** Max age for completed task lifecycle events (default: 14 days) */
	taskEventsMaxAgeMs?: number
	/** Max rows to retain in nodes table (default: 10000) */
	nodesMaxRows?: number
	/** Max rows to retain in trees table (default: 10000) */
	treesMaxRows?: number
	/** Max age in milliseconds for stashes (default: 14 days) */
	stashesMaxAgeMs?: number
	/** Max age in milliseconds for completed/failed streams (default: 14 days) */
	streamsMaxAgeMs?: number
	/** Max age in milliseconds for completed/failed tasks (default: 14 days) */
	tasksMaxAgeMs?: number
	/** Max age in milliseconds for decisions (default: 30 days) */
	decisionsMaxAgeMs?: number
}

export class SQLiteMaintenanceEngine {
	private maintenanceInterval: NodeJS.Timeout | null = null
	private isRunning = false

	constructor(private policy: RetentionPolicy = {}) {}

	public start(intervalMs = 5 * 60 * 1000): void {
		if (this.maintenanceInterval) return
		this.maintenanceInterval = setInterval(() => {
			this.runMaintenance().catch((err) => {
				Logger.error("[SQLiteMaintenanceEngine] Maintenance run failed:", err)
			})
		}, intervalMs)
		this.maintenanceInterval.unref?.()
	}

	public stop(): void {
		if (this.maintenanceInterval) {
			clearInterval(this.maintenanceInterval)
			this.maintenanceInterval = null
		}
	}

	public async runMaintenance(options?: { forceTruncateWal?: boolean }): Promise<{
		prunedClaims: number
		prunedLocks: number
		prunedTelemetry: number
		prunedAuditEvents: number
		prunedKnowledge: number
		prunedReflogs: number
		prunedNodes: number
		prunedTrees: number
		prunedFiles: number
		prunedOrphanEdges: number
		prunedStreamsAndTasks: number
		prunedDecisions: number
		freelistPagesVacuumed: number
		walCheckpointResult: { busy: number; log: number; checkpointed: number }
		ftsOptimized: boolean
	}> {
		if (isSqlitePersistenceBypassed() || this.isRunning) {
			return {
				prunedClaims: 0,
				prunedLocks: 0,
				prunedTelemetry: 0,
				prunedAuditEvents: 0,
				prunedKnowledge: 0,
				prunedReflogs: 0,
				prunedNodes: 0,
				prunedTrees: 0,
				prunedFiles: 0,
				prunedOrphanEdges: 0,
				prunedStreamsAndTasks: 0,
				prunedDecisions: 0,
				freelistPagesVacuumed: 0,
				walCheckpointResult: { busy: 0, log: 0, checkpointed: 0 },
				ftsOptimized: false,
			}
		}

		this.isRunning = true
		try {
			const db = await getDb()
			const rawDb = await getRawDb()
			const now = Date.now()

			// 1. Purge expired claims, swarm locks & expired ephemeral branches
			const claimsRes = await db.deleteFrom("claims").where("expiresAt", "<", now).executeTakeFirst()
			const prunedClaims = Number(claimsRes.numDeletedRows || 0)

			const locksRes = await db.deleteFrom("swarm_locks").where("expiresAt", "<", now).executeTakeFirst()
			const prunedLocks = Number(locksRes.numDeletedRows || 0)

			try {
				await db
					.deleteFrom("branches")
					.where("isEphemeral", "=", 1)
					.where("expiresAt", "is not", null)
					.where("expiresAt", "<", now)
					.executeTakeFirst()

				await db.executeQuery(
					CompiledQuery.raw(
						`DELETE FROM swarm_lock_generations WHERE resourceKey NOT IN (SELECT resource FROM swarm_locks)`,
					),
				)
			} catch {}

			// 2. Prune telemetry table (age & row count limit)
			let prunedTelemetry = 0
			const telemetryMaxAgeMs = this.policy.telemetryMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000
			const telemetryMaxRows = this.policy.telemetryMaxRows ?? 25000
			const telemetryAgeCutoff = now - telemetryMaxAgeMs

			const telemetryAgeRes = await db
				.deleteFrom("telemetry")
				.where("timestamp", "<", telemetryAgeCutoff)
				.executeTakeFirst()
			prunedTelemetry += Number(telemetryAgeRes.numDeletedRows || 0)

			try {
				const countRes = await db.selectFrom("telemetry").select(db.fn.count<number>("id").as("cnt")).executeTakeFirst()
				const currentTelemetryCount = Number(countRes?.cnt || 0)
				if (currentTelemetryCount > telemetryMaxRows) {
					const deleteCount = currentTelemetryCount - telemetryMaxRows
					await db.executeQuery(
						CompiledQuery.raw(
							`DELETE FROM telemetry WHERE id IN (SELECT id FROM telemetry ORDER BY timestamp ASC LIMIT ${deleteCount})`,
						),
					)
					prunedTelemetry += deleteCount
				}
			} catch {}

			// 3. Prune audit_events table
			let prunedAuditEvents = 0
			const auditMaxAgeMs = this.policy.auditMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000
			const auditMaxRows = this.policy.auditMaxRows ?? 25000
			const auditAgeCutoff = now - auditMaxAgeMs

			const auditAgeRes = await db.deleteFrom("audit_events").where("createdAt", "<", auditAgeCutoff).executeTakeFirst()
			prunedAuditEvents += Number(auditAgeRes.numDeletedRows || 0)

			try {
				const countRes = await db
					.selectFrom("audit_events")
					.select(db.fn.count<number>("id").as("cnt"))
					.executeTakeFirst()
				const currentAuditCount = Number(countRes?.cnt || 0)
				if (currentAuditCount > auditMaxRows) {
					const deleteCount = currentAuditCount - auditMaxRows
					await db.executeQuery(
						CompiledQuery.raw(
							`DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events ORDER BY createdAt ASC LIMIT ${deleteCount})`,
						),
					)
					prunedAuditEvents += deleteCount
				}
			} catch {}

			// 4. Prune expired knowledge items & orphan knowledge edges
			let prunedKnowledge = 0
			let prunedOrphanEdges = 0
			try {
				const knowledgeRes = await db
					.deleteFrom("knowledge")
					.where("expiresAt", "is not", null)
					.where("expiresAt", "<", now)
					.executeTakeFirst()
				prunedKnowledge += Number(knowledgeRes.numDeletedRows || 0)

				const agentKnowledgeRes = await db
					.deleteFrom("agent_knowledge")
					.where("expiresAt", "is not", null)
					.where("expiresAt", "<", now)
					.executeTakeFirst()
				prunedKnowledge += Number(agentKnowledgeRes.numDeletedRows || 0)

				// Delete orphaned knowledge_edges
				const edgeRes1 = await db.executeQuery(
					CompiledQuery.raw(
						`DELETE FROM knowledge_edges WHERE sourceId NOT IN (SELECT id FROM knowledge) OR targetId NOT IN (SELECT id FROM knowledge)`,
					),
				)
				prunedOrphanEdges += Number(edgeRes1.numAffectedRows || 0)

				// Delete orphaned agent_knowledge_edges
				const edgeRes2 = await db.executeQuery(
					CompiledQuery.raw(
						`DELETE FROM agent_knowledge_edges WHERE sourceId NOT IN (SELECT id FROM agent_knowledge) OR targetId NOT IN (SELECT id FROM agent_knowledge)`,
					),
				)
				prunedOrphanEdges += Number(edgeRes2.numAffectedRows || 0)
			} catch {}

			// 5. Prune reflogs and cognitive snapshots older than 30 days or exceeding row limits
			let prunedReflogs = 0
			try {
				const cutoff = now - 30 * 24 * 60 * 60 * 1000
				const reflogRes = await db.deleteFrom("reflog").where("timestamp", "<", cutoff).executeTakeFirst()
				prunedReflogs = Number(reflogRes.numDeletedRows || 0)

				await db.deleteFrom("agent_cognitive_snapshots").where("createdAt", "<", cutoff).executeTakeFirst()

				const snapshotsCountRes = await db
					.selectFrom("agent_cognitive_snapshots")
					.select(db.fn.count<number>("id").as("cnt"))
					.executeTakeFirst()
				const currentSnapshotsCount = Number(snapshotsCountRes?.cnt || 0)
				const snapshotsMaxRows = 5000
				if (currentSnapshotsCount > snapshotsMaxRows) {
					const deleteCount = currentSnapshotsCount - snapshotsMaxRows
					await db.executeQuery(
						CompiledQuery.raw(
							`DELETE FROM agent_cognitive_snapshots WHERE id IN (SELECT id FROM agent_cognitive_snapshots ORDER BY createdAt ASC LIMIT ${deleteCount})`,
						),
					)
				}

				// Prune orphaned telemetry_aggregates for task_* IDs no longer in tasks/agent_tasks
				await db.executeQuery(
					CompiledQuery.raw(
						`DELETE FROM telemetry_aggregates WHERE id LIKE 'task_%' AND SUBSTR(id, 6) NOT IN (SELECT id FROM agent_tasks)`,
					),
				)
			} catch {}

			// 6. Prune nodes, trees, stashes, decisions, streams, tasks, and task lifecycle events
			let prunedNodes = 0
			let prunedTrees = 0
			let prunedStreamsAndTasks = 0
			let prunedDecisions = 0

			try {
				const nodesMaxRows = this.policy.nodesMaxRows ?? 10000
				const countRes = await db.selectFrom("nodes").select(db.fn.count<number>("id").as("cnt")).executeTakeFirst()
				const currentNodesCount = Number(countRes?.cnt || 0)
				if (currentNodesCount > nodesMaxRows) {
					const deleteCount = currentNodesCount - nodesMaxRows
					const delRes = await db.executeQuery(
						CompiledQuery.raw(
							`DELETE FROM nodes WHERE id IN (SELECT id FROM nodes ORDER BY timestamp ASC LIMIT ${deleteCount})`,
						),
					)
					prunedNodes = Number(delRes.numAffectedRows || 0)
				}
			} catch {}

			try {
				const treesMaxRows = this.policy.treesMaxRows ?? 10000
				const countRes = await db.selectFrom("trees").select(db.fn.count<number>("id").as("cnt")).executeTakeFirst()
				const currentTreesCount = Number(countRes?.cnt || 0)
				if (currentTreesCount > treesMaxRows) {
					const deleteCount = currentTreesCount - treesMaxRows
					const delRes = await db.executeQuery(
						CompiledQuery.raw(
							`DELETE FROM trees WHERE id IN (SELECT id FROM trees ORDER BY createdAt ASC LIMIT ${deleteCount})`,
						),
					)
					prunedTrees = Number(delRes.numAffectedRows || 0)
				}
			} catch {}

			try {
				const stashesMaxAgeMs = this.policy.stashesMaxAgeMs ?? 14 * 24 * 60 * 60 * 1000
				const stashesCutoff = now - stashesMaxAgeMs
				await db.deleteFrom("stashes").where("createdAt", "<", stashesCutoff).executeTakeFirst()
			} catch {}

			try {
				const streamsMaxAgeMs = this.policy.streamsMaxAgeMs ?? 14 * 24 * 60 * 60 * 1000
				const streamsCutoff = now - streamsMaxAgeMs
				const streamRes = await db
					.deleteFrom("agent_streams")
					.where("status", "in", ["completed", "failed"])
					.where("createdAt", "<", streamsCutoff)
					.executeTakeFirst()
				prunedStreamsAndTasks += Number(streamRes.numDeletedRows || 0)

				const tasksMaxAgeMs = this.policy.tasksMaxAgeMs ?? 14 * 24 * 60 * 60 * 1000
				const tasksCutoff = now - tasksMaxAgeMs
				const taskRes = await db
					.deleteFrom("agent_tasks")
					.where("status", "in", ["completed", "failed"])
					.where("createdAt", "<", tasksCutoff)
					.executeTakeFirst()
				prunedStreamsAndTasks += Number(taskRes.numDeletedRows || 0)

				// Prune legacy tasks table
				await db
					.deleteFrom("tasks")
					.where("status", "in", ["completed", "failed"])
					.where("updatedAt", "<", tasksCutoff)
					.executeTakeFirst()

				// Prune orphaned memory for deleted streams
				await db.executeQuery(
					CompiledQuery.raw(`DELETE FROM agent_memory WHERE streamId NOT IN (SELECT id FROM agent_streams)`),
				)
			} catch {}

			try {
				const decisionsMaxAgeMs = this.policy.decisionsMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000
				const decisionsCutoff = now - decisionsMaxAgeMs
				const decRes = await db.deleteFrom("decisions").where("timestamp", "<", decisionsCutoff).executeTakeFirst()
				prunedDecisions = Number(decRes.numDeletedRows || 0)
			} catch {}

			try {
				const taskEventsMaxAgeMs = this.policy.taskEventsMaxAgeMs ?? 14 * 24 * 60 * 60 * 1000
				const taskEventsCutoff = now - taskEventsMaxAgeMs
				await db.deleteFrom("task_lifecycle_events").where("committedAt", "<", taskEventsCutoff).executeTakeFirst()
				await db.deleteFrom("task_completions").where("committedAt", "<", taskEventsCutoff).executeTakeFirst()
				await db.deleteFrom("task_rejections").where("committedAt", "<", taskEventsCutoff).executeTakeFirst()
				await db.deleteFrom("completion_attempts").where("createdAt", "<", taskEventsCutoff).executeTakeFirst()
				await db.deleteFrom("task_lifecycle_records").where("updatedAt", "<", taskEventsCutoff).executeTakeFirst()
			} catch {}

			// 7. Prune orphaned CAS files
			let prunedFiles = 0
			try {
				// Delete files whose hash (id) does not appear in any tree object, tree entries, or node tree
				const delFilesRes = await db.executeQuery(
					CompiledQuery.raw(
						`DELETE FROM files WHERE id NOT IN (SELECT id FROM trees) AND NOT EXISTS (SELECT 1 FROM trees WHERE INSTR(trees.entries, files.id) > 0)`,
					),
				)
				prunedFiles = Number(delFilesRes.numAffectedRows || 0)
			} catch {}

			// 8. Optimize FTS5 Indexes & SQLite Query Planner
			let ftsOptimized = false
			try {
				await db.executeQuery(CompiledQuery.raw("INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')"))
				rawDb.pragma("optimize")
				ftsOptimized = true
			} catch {}

			// 9. Incremental Vacuum loop to release ALL freelist pages to disk
			let freelistPagesVacuumed = 0
			try {
				let freelist = (rawDb.pragma("freelist_count", { simple: true }) as number) || 0
				let passes = 0
				const MAX_VACUUM_PASSES = 50 // Guardrail against infinite loops
				while (freelist > 0 && passes < MAX_VACUUM_PASSES) {
					const before = freelist
					rawDb.pragma("incremental_vacuum(1000)")
					freelist = (rawDb.pragma("freelist_count", { simple: true }) as number) || 0
					const reclaimed = Math.max(0, before - freelist)
					freelistPagesVacuumed += reclaimed
					passes++
					if (reclaimed === 0) break // No further progress
				}
			} catch {}

			// 10. WAL Checkpoint with automated WAL size guardrail & backoff retry loop
			let walResult = { busy: 0, log: 0, checkpointed: 0 }
			try {
				const metrics = await getDbStorageMetrics()
				const walOverThreshold = metrics.walSizeBytes > 32 * 1024 * 1024 // 32MB guardrail

				let pragmaCmd = "wal_checkpoint(RESTART)"
				if (options?.forceTruncateWal || walOverThreshold) {
					pragmaCmd = "wal_checkpoint(TRUNCATE)"
				}

				let retries = 0
				const MAX_CHECKPOINT_RETRIES = 3
				let res: Array<{ busy: number; log: number; checkpointed: number }> = []

				while (retries <= MAX_CHECKPOINT_RETRIES) {
					res = rawDb.pragma(pragmaCmd) as Array<{ busy: number; log: number; checkpointed: number }>
					if (res?.[0]?.busy && retries < MAX_CHECKPOINT_RETRIES) {
						retries++
						await new Promise((resolve) => setTimeout(resolve, 50 * retries))
					} else {
						break
					}
				}

				if (res?.[0]?.busy) {
					// Fallback to PASSIVE if RESTART/TRUNCATE encountered busy readers after retries
					res = rawDb.pragma("wal_checkpoint(PASSIVE)") as Array<{ busy: number; log: number; checkpointed: number }>
				}

				if (res?.[0]) {
					walResult = {
						busy: res[0].busy ?? 0,
						log: res[0].log ?? 0,
						checkpointed: res[0].checkpointed ?? 0,
					}
				}
			} catch {}

			if (
				prunedClaims > 0 ||
				prunedLocks > 0 ||
				prunedTelemetry > 0 ||
				prunedAuditEvents > 0 ||
				prunedKnowledge > 0 ||
				prunedReflogs > 0 ||
				prunedNodes > 0 ||
				prunedTrees > 0 ||
				prunedFiles > 0 ||
				prunedOrphanEdges > 0 ||
				prunedStreamsAndTasks > 0 ||
				prunedDecisions > 0 ||
				freelistPagesVacuumed > 0 ||
				ftsOptimized
			) {
				Logger.info(
					`[SQLiteMaintenanceEngine] Maintenance completed: claims=${prunedClaims}, locks=${prunedLocks}, telemetry=${prunedTelemetry}, audit=${prunedAuditEvents}, knowledge=${prunedKnowledge}, reflogs=${prunedReflogs}, nodes=${prunedNodes}, trees=${prunedTrees}, files=${prunedFiles}, orphanEdges=${prunedOrphanEdges}, streams/tasks=${prunedStreamsAndTasks}, decisions=${prunedDecisions}, pagesVacuumed=${freelistPagesVacuumed}, ftsOptimized=${ftsOptimized}, walCheckpoint=${JSON.stringify(walResult)}`,
				)
			}

			return {
				prunedClaims,
				prunedLocks,
				prunedTelemetry,
				prunedAuditEvents,
				prunedKnowledge,
				prunedReflogs,
				prunedNodes,
				prunedTrees,
				prunedFiles,
				prunedOrphanEdges,
				prunedStreamsAndTasks,
				prunedDecisions,
				freelistPagesVacuumed,
				walCheckpointResult: walResult,
				ftsOptimized,
			}
		} finally {
			this.isRunning = false
		}
	}

	public async getStorageHealthReport(): Promise<{
		fileSizeBytes: number
		walSizeBytes: number
		freelistCount: number
		fragmentationRatio: number
		healthStatus: "healthy" | "bloated" | "critical"
		recommendations: string[]
	}> {
		const metrics = await getDbStorageMetrics()
		const freelistRatio = metrics.pageCount > 0 ? metrics.freelistCount / metrics.pageCount : 0
		const recommendations: string[] = []
		let healthStatus: "healthy" | "bloated" | "critical" = "healthy"

		if (freelistRatio > 0.3) {
			healthStatus = "bloated"
			recommendations.push(
				`Freelist page ratio is high (${(freelistRatio * 100).toFixed(1)}%). Incremental vacuum recommended.`,
			)
		}
		if (metrics.walSizeBytes > 32 * 1024 * 1024) {
			healthStatus = "critical"
			recommendations.push(
				`WAL log file size is large (${(metrics.walSizeBytes / 1024 / 1024).toFixed(1)} MB). Forced WAL checkpoint recommended.`,
			)
		}

		return {
			fileSizeBytes: metrics.fileSizeBytes,
			walSizeBytes: metrics.walSizeBytes,
			freelistCount: metrics.freelistCount,
			fragmentationRatio: Number(freelistRatio.toFixed(3)),
			healthStatus,
			recommendations,
		}
	}
}

export const sqliteMaintenanceEngine = new SQLiteMaintenanceEngine()
