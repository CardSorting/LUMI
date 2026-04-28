import * as path from "path"
import { v4 as uuidv4 } from "uuid"
import { Logger } from "@/shared/services/Logger"
import { dbPool } from "../db/BufferedDbPool"

export interface AgentStream {
	id: string
	externalId: string | null
	parentId: string | null
	focus: string
	status: "active" | "completed" | "failed"
	sharedMemoryLayer: string | null // V34: Structured Swarm Persistence
	createdAt: number
}

export interface TaskAuditMetadata {
	joy_zoning_violations?: string[]
	result_checksum?: string
	divergence_detected?: boolean
	entropy_score?: number
	violations?: string[]
}

export interface AgentTask {
	id: string
	streamId: string
	description: string
	subagent_type?: "worker" | "verifier" | "researcher"
	status: "pending" | "running" | "completed" | "failed"
	result: string | null
	linkedKnowledgeIds?: string[]
	metadata?: TaskAuditMetadata
	createdAt: number
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type ConversationContentBlock = JsonValue
type ConversationMessage = {
	role: "user" | "assistant"
	content: string | ConversationContentBlock[]
}
type LogicalSoundnessContext = {
	getLogicalSoundness(knowledgeIds: string[]): Promise<number>
}

export class AgentOrchestrator {
	public async createStream(
		focus: string,
		parentId: string | null = null,
		externalId: string | null = null,
	): Promise<AgentStream> {
		const streamId = uuidv4()
		await dbPool.beginWork(streamId)

		try {
			const stream: AgentStream = {
				id: streamId,
				externalId,
				parentId,
				focus,
				status: "active",
				sharedMemoryLayer: null, // V34 Recovery
				createdAt: Date.now(),
			}

			await dbPool.push(
				{
					type: "insert",
					table: "agent_streams",
					values: { ...stream },
					layer: "infrastructure",
				},
				streamId,
			)

			await dbPool.commitWork(streamId)
			return stream
		} catch (error) {
			await dbPool.rollbackWork(
				streamId,
				`Stream creation failed: ${error instanceof Error ? error.message : String(error)}`,
			)
			throw error
		}
	}

	public async createTask(
		streamId: string,
		description: string,
		subagent_type: AgentTask["subagent_type"] = "worker",
	): Promise<AgentTask> {
		const now = Date.now()
		const task: AgentTask = {
			id: uuidv4(),
			streamId,
			description,
			subagent_type,
			status: "pending",
			result: null,
			createdAt: now,
		}

		await dbPool.push({
			type: "insert",
			table: "agent_tasks",
			values: { ...task, metadata: null },
			layer: "infrastructure",
		})

		return task
	}

	public async auditTask(
		_taskId: string,
		_taskDescription: string,
		_taskResult: string,
		_streamFocus: string,
	): Promise<TaskAuditMetadata> {
		return {}
	}

	public async updateTaskStatus(
		taskId: string,
		status: AgentTask["status"],
		result: string | null = null,
		metadata?: TaskAuditMetadata,
	): Promise<void> {
		const values: Record<string, unknown> = { status }
		if (result !== null) values.result = result
		if (metadata) values.metadata = JSON.stringify(metadata)

		await dbPool.push({
			type: "update",
			table: "agent_tasks",
			values,
			where: { column: "id", value: taskId },
			layer: "infrastructure",
		})
	}

	public async getActiveStreams(requestingAgentId?: string): Promise<AgentStream[]> {
		const all = await dbPool.selectAllFrom("agent_streams", requestingAgentId)
		return all.filter((s) => s.status === "active")
	}

	public async getStreamByExternalId(externalId: string): Promise<AgentStream | null> {
		return dbPool.selectOne("agent_streams", { column: "externalId", value: externalId })
	}

	public async storeMemory(streamId: string, key: string, value: string): Promise<void> {
		await dbPool.push(
			{
				type: "upsert",
				table: "agent_memory",
				values: { streamId, key, value, updatedAt: Date.now() },
				layer: "domain",
			},
			streamId,
			`agent_memory:${streamId}:${key}`,
		)
	}

	public async recallMemory(streamId: string, key: string): Promise<string | null> {
		const found = await dbPool.selectOne(
			"agent_memory",
			[
				{ column: "streamId", value: streamId },
				{ column: "key", value: key },
			],
			streamId,
		)
		return found ? found.value : null
	}

	public async getSwarmFindings(streamId: string): Promise<string[]> {
		const items = await dbPool.selectWhere("agent_memory", { column: "streamId", value: streamId })
		return items.filter((item) => item.key.startsWith("swarm_finding_")).map((item) => item.value)
	}

	public async getStreamTasks(streamId: string, requestingAgentId?: string): Promise<AgentTask[]> {
		const results = await dbPool.selectWhere("agent_tasks", { column: "streamId", value: streamId }, requestingAgentId)
		return results.map((t) => ({
			...t,
			linkedKnowledgeIds: t.linkedKnowledgeIds ? JSON.parse(t.linkedKnowledgeIds) : [],
			metadata: t.metadata ? JSON.parse(t.metadata) : undefined,
		})) as AgentTask[]
	}

	// ── Subagent Signaling Protocol ──────────────────────────────────

	/**
	 * Spawn a child stream linked to a parent. The parent stream ID
	 * is recorded to reconstruct the execution tree later.
	 */
	public async spawnChildStream(parentStreamId: string, focus: string): Promise<AgentStream> {
		return this.createStream(focus, parentStreamId)
	}

	/**
	 * Get all child streams for a given parent.
	 */
	public async getChildStreams(parentStreamId: string): Promise<AgentStream[]> {
		return dbPool.selectWhere("agent_streams", { column: "parentId", value: parentStreamId })
	}

	/**
	 * Mark a stream as completed and store a summary in agent memory.
	 * Returns a structured XML notification for autonomous coordination.
	 */
	public async completeStream(streamId: string, summary: string): Promise<string> {
		// Commit any pending shadow work before storing the completion summary
		await dbPool.commitWork(streamId)

		const taskNotification = `
<task-notification>
<task-id>${streamId}</task-id>
<status>completed</status>
<summary>${summary.slice(0, 100)}...</summary>
<result>${summary}</result>
</task-notification>`.trim()

		await dbPool.pushBatch(
			[
				{
					type: "update",
					table: "agent_streams",
					values: { status: "completed" },
					where: { column: "id", value: streamId },
					layer: "infrastructure",
				},
				{
					type: "upsert",
					table: "agent_memory",
					values: { streamId, key: "stream_summary", value: summary, updatedAt: Date.now() },
					layer: "domain",
				},
			],
			streamId,
		)

		return taskNotification
	}

	/**
	 * Mark a stream as failed and store the error reason.
	 */
	public async failStream(streamId: string, reason: string): Promise<void> {
		await dbPool.push({
			type: "update",
			table: "agent_streams",
			values: { status: "failed" },
			where: { column: "id", value: streamId },
			layer: "infrastructure",
		})
		await this.storeMemory(streamId, "failure_reason", reason)
	}

	// ── Context-Window Compression ──────────────────────────────────

	/**
	 * Generate a compressed context digest for a stream.
	 * Retrieves all tasks and memory entries, then produces
	 * a compact JSON summary suitable for injection into a
	 * new agent's context window.
	 */
	public async getCompressedContext(streamId: string, agentContext?: LogicalSoundnessContext): Promise<string> {
		const tasks = await this.getStreamTasks(streamId)
		const summary = await this.recallMemory(streamId, "stream_summary")
		const failureReason = await this.recallMemory(streamId, "failure_reason")

		// [Pillar 4] Epistemic Score injection
		let soundness = 1.0
		if (agentContext) {
			const knowledgeIds = tasks.flatMap((t) => t.linkedKnowledgeIds || [])
			if (knowledgeIds.length > 0) {
				soundness = await agentContext.getLogicalSoundness(knowledgeIds)
			}
		}

		// Count child streams
		const allStreams = await dbPool.selectAllFrom("agent_streams")
		const childStreams = allStreams.filter((s) => s.parentId === streamId)

		const completedTasks = tasks.filter((t) => t.status === "completed").length
		const failedTasks = tasks.filter((t) => t.status === "failed").length
		const violations = tasks
			.filter((t) => t.metadata?.joy_zoning_violations)
			.flatMap((t) => t.metadata?.joy_zoning_violations as string[])

		const avgEntropy =
			tasks
				.filter((t) => t.metadata?.entropy_score !== undefined)
				.reduce((acc, t) => acc + (t.metadata?.entropy_score || 0), 0) /
			(tasks.filter((t) => t.metadata?.entropy_score !== undefined).length || 1)

		const digest = {
			streamId,
			summary: summary || "No summary available",
			failureReason: failureReason || undefined,
			soundnessScore: Number(soundness.toFixed(2)),
			avgEntropy: Number(avgEntropy.toFixed(2)),
			stats: {
				totalTasks: tasks.length,
				completedTasks,
				failedTasks,
				childStreams: childStreams.length,
				violationsCount: violations.length,
			},
			uniqueViolations: [...new Set(violations)],
			lastActivity: tasks.length > 0 ? Math.max(...tasks.map((t) => t.createdAt)) : null,
		}

		return JSON.stringify(digest, null, 2)
	}

	// ── Fluid Coordination Hooks ─────────────────────────────────────

	/**
	 * Check if any files being touched by the requesting stream
	 * are currently locked/mutated by a sibling stream.
	 */
	public async checkCollision(requestingStreamId: string, files: string[]): Promise<string | null> {
		const activeFiles = await dbPool.getActiveAffectedFiles()
		for (const file of files) {
			const agentId = activeFiles.get(file)
			if (agentId && agentId !== requestingStreamId) {
				return `Collision detected: File '${path.basename(file)}' is currently being modified by Stream ${agentId.slice(0, 8)}.`
			}
		}
		return null
	}

	/**
	 * Calculate result entropy (divergence severity).
	 * Simple length-based delta for now, but provides a 0-1 score.
	 */
	/**
	 * Calculates a physical entropy score (0.0-1.0) based on content divergence.
	 * Uses Jaccard Similarity on 3-gram sets for structural comparison.
	 */
	public calculateEntropy(prev: string | null, current: string): number {
		if (!prev) return 0
		if (prev === current) return 0

		const getGrams = (str: string, size = 3): Set<string> => {
			const grams = new Set<string>()
			for (let i = 0; i <= str.length - size; i++) {
				grams.add(str.slice(i, i + size))
			}
			return grams
		}

		const gramsPrev = getGrams(prev)
		const gramsCurr = getGrams(current)

		if (gramsPrev.size === 0 || gramsCurr.size === 0) return 1.0

		const intersection = new Set([...gramsPrev].filter((x) => gramsCurr.has(x)))
		const union = new Set([...gramsPrev, ...gramsCurr])

		const similarity = intersection.size / union.size
		const entropy = 1 - similarity

		return Number(entropy.toFixed(2))
	}

	/**
	 * Swarm Signaling (Vibe Checks).
	 * Absorbed from src/utils/agentSwarmsEnabled.ts.
	 */
	public async emitSwarmSignal(streamId: string, signal: { type: "vibe" | "audit" | "error"; value: string }): Promise<void> {
		Logger.info(`[Orchestrator] Swarm Signal from ${streamId.slice(0, 8)}: ${signal.type}=${signal.value}`)

		const signalKey = `swarm_signal_${Date.now()}`
		await dbPool.push({
			type: "insert",
			table: "agent_memory",
			values: {
				streamId,
				key: signalKey,
				value: JSON.stringify({ ...signal, timestamp: Date.now() }),
				updatedAt: Date.now(),
			},
		})
	}

	/**
	 * Pre-audit user intent using the Ephemeral Side Reasoning thread.
	 * Absorbed from src/utils/sideQuery.ts.
	 */
	public async preAuditIntent(_userInput: string): Promise<string> {
		Logger.info(`[Orchestrator] 🌓 Pre-Auditing User Intent...`)
		// Direct instantiation for now, assuming workspace will provide this in production
		// For this implementation, we use a placeholder that delegates to our SideQueryService pattern
		return "REFACTOR" // Simplified placeholder for the walkthrough
	}

	/**
	 * Level 10: Sovereign Swarm Orchestration.
	 * Spawns an "In-Process Teammate" that shares the workspace memory.
	 * Absorbed from src/utils/swarm/spawnInProcess.ts.
	 */
	public async spawnTeammateTask(parentStreamId: string, agentId: string, prompt: string): Promise<string> {
		const parentStream = (await dbPool.selectAllFrom("agent_streams")).find((s) => s.id === parentStreamId)
		if (!parentStream) throw new Error(`Parent stream ${parentStreamId} not found.`)

		Logger.info(`[Orchestrator] Spawning Sovereign Teammate ${agentId} for task: ${prompt.slice(0, 50)}...`)

		// Initialize Warm Teammate Stream
		const streamId = uuidv4()
		await dbPool.push({
			type: "insert",
			table: "agent_streams",
			values: {
				id: streamId,
				parentId: parentStreamId,
				externalId: agentId,
				focus: prompt, // Use prompt as focus if parent doesn't specify
				status: "active",
				sharedMemoryLayer: parentStream.sharedMemoryLayer,
				createdAt: Date.now(),
			},
		})

		// Store shared workspace info in memory
		if (parentStream.sharedMemoryLayer) {
			await dbPool.push({
				type: "insert",
				table: "agent_memory",
				values: {
					streamId,
					key: "sharedMemoryLayer",
					value: parentStream.sharedMemoryLayer,
					updatedAt: Date.now(),
				},
			})
		}

		// Notify Parent Mailbox
		await this.emitSwarmSignal(parentStreamId, {
			type: "vibe",
			value: `Teammate ${agentId} deployed for task: ${prompt.slice(0, 50)}...`,
		})

		return streamId
	}

	/**
	 * Level 9: Sovereign Recovery (Warmup)
	 * Reconstitutes the agent's "Brain" (RAM) from the "Notebook" (Disk)
	 * by populating Level 7 indices for all active workflows.
	 */
	public async warmup(): Promise<void> {
		const start = performance.now()
		const activeStreams = await dbPool.selectAllFrom("agent_streams")
		const activeIds = activeStreams.filter((s) => s.status === "active").map((s) => s.id)

		if (activeIds.length === 0) return

		// V215: Throttled Recovery (Concurrency Limit: 5)
		// Prevents heap exhaustion when reconstituting many active workflows simultaneously.
		const BATCH_SIZE = 5
		for (let i = 0; i < activeIds.length; i += BATCH_SIZE) {
			const batch = activeIds.slice(i, i + BATCH_SIZE)
			await Promise.all([
				dbPool.warmupTable("agent_streams", "status", "active"),
				dbPool.warmupTable("agent_tasks", "status", "pending"),
				dbPool.warmupTable("agent_tasks", "status", "running"),
				...batch.map((id) => dbPool.warmupTable("agent_memory", "streamId", id)),
			])
		}

		const duration = (performance.now() - start).toFixed(1)
		Logger.info(`[Orchestrator] Sovereign Warmup Complete in ${duration}ms (Level 9 Active)`)
	}

	public async getConversationHistory(streamId: string): Promise<ConversationMessage[]> {
		const tasks = await this.getStreamTasks(streamId)
		const history: ConversationMessage[] = []

		for (const task of tasks) {
			// user turn: description is the intent/prompt
			history.push({
				role: "user",
				content: task.description,
			})

			// assistant turn: result is the output (including potential tool calls)
			if (task.result) {
				let content: JsonValue = task.result
				try {
					// Handle JSON results (common in subagent tool-calling outputs)
					if (task.result.trim().startsWith("{") || task.result.trim().startsWith("[")) {
						content = JSON.parse(task.result)
					}
				} catch (_e) {
					// Fallback to raw string
				}

				// V34: Standardize block format for SovereignScribe compatibility
				const contentBlocks = Array.isArray(content)
					? content
					: typeof content === "object"
						? [content]
						: [{ type: "text", text: String(content) }]

				history.push({
					role: "assistant",
					content: contentBlocks,
				})
			}
		}

		return history
	}

	public getLayerForPath(filePath: string): string {
		const { getLayer } = require("@/utils/joy-zoning")
		return getLayer(filePath)
	}
}

export const orchestrator = new AgentOrchestrator()
