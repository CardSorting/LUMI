import { createHash } from "crypto"
import { nanoid } from "nanoid"
import { Logger } from "@/shared/services/Logger"
import { BufferedDbPool, dbPool, type WriteOp } from "../../infrastructure/db/BufferedDbPool"
import { getDb, type Schema } from "../../infrastructure/db/Config"

export interface EmbeddingHandler {
	embedText(text: string): Promise<number[] | null>
}

export interface KnowledgeNode {
	id: string
	streamId: string
	type: string
	content: string
	tags: string[]
	embedding: number[] | null
	confidence: number
	hubScore: number
	metadata?: any
	createdAt: number
}

export interface KnowledgeEdge {
	sourceId: string
	targetId: string
	type: string
	weight: number
	createdAt: number
}

export interface GraphTraversalFilter {
	edgeTypes?: string[]
	minWeight?: number
	direction?: "outbound" | "inbound" | "both"
}

export class KnowledgeGraphService {
	private static instance: KnowledgeGraphService | null = null
	private embeddingHandler: EmbeddingHandler
	private cleanupInterval: NodeJS.Timeout | null = null
	private isEmbeddingDisabled = false

	private constructor(embeddingHandler: EmbeddingHandler) {
		this.embeddingHandler = embeddingHandler
		this.startCleanupLoop()
	}

	public static async getInstance(embeddingHandler: EmbeddingHandler): Promise<KnowledgeGraphService> {
		if (!KnowledgeGraphService.instance) {
			KnowledgeGraphService.instance = new KnowledgeGraphService(embeddingHandler)
		}
		return KnowledgeGraphService.instance
	}

	private async _push(op: WriteOp, agentId?: string) {
		try {
			await dbPool.push(op, agentId)
		} catch (error) {
			Logger.warn(`[KnowledgeGraphService] Failed to push operation to DB pool: ${error}`)
			// V9: Silent fallback - we don't throw to prevent blocking the agent
		}
	}

	public calculateHash(content: string): string {
		return createHash("sha256").update(content).digest("hex")
	}

	private startCleanupLoop() {
		if (this.cleanupInterval) return
		this.cleanupInterval = setInterval(() => this.cleanupGhostTasks(), 15 * 60 * 1000) // 15 mins
	}

	async cleanupGhostTasks() {
		const now = Date.now()
		const db = await getDb()
		const expired = await db.selectFrom("agent_knowledge").select("id").where("expiresAt", "<", now).execute()

		for (const node of expired) {
			await this.deleteKnowledge(node.id)
		}
	}

	/**
	 * Append a global rule or guideline to the swarm-wide shared memory layer.
	 */
	async appendSharedMemory(streamId: string, memory: string): Promise<void> {
		const stream: Schema["agent_streams"] | null = await dbPool.selectOne("agent_streams", [
			{ column: "id", value: streamId },
		])
		const current = JSON.parse(stream?.sharedMemoryLayer || "[]")
		current.push(memory)
		await this._push({
			type: "update",
			table: "agent_streams",
			where: [{ column: "id", value: streamId }],
			values: { sharedMemoryLayer: JSON.stringify(current) },
			layer: "domain",
		})
	}

	/**
	 * Get the shared memory layer for a stream (including inherited from parents).
	 */
	async getSharedMemory(streamId: string): Promise<string[]> {
		const memories: string[] = []
		let currentId: string | null = streamId

		while (currentId) {
			const stream: Schema["agent_streams"] | null = await dbPool.selectOne("agent_streams", [
				{ column: "id", value: currentId },
			])
			if (stream?.sharedMemoryLayer) {
				const layer = JSON.parse(stream.sharedMemoryLayer)
				memories.unshift(...layer) // Parents first
			}
			currentId = stream?.parentId || null
		}

		return memories
	}

	async addKnowledge(
		streamId: string,
		type: string,
		content: string,
		options: {
			tags?: string[]
			embedding?: number[]
			confidence?: number
			expiresAt?: number
			metadata?: any
		} = {},
	): Promise<string> {
		const id = nanoid()
		let embedding = options.embedding || null

		if (!embedding && content.trim() && !this.isEmbeddingDisabled) {
			try {
				embedding = await this.embeddingHandler.embedText(content)
				if (!embedding) {
					Logger.warn("[KnowledgeGraphService] Disabling embeddings due to null result in addKnowledge")
					this.isEmbeddingDisabled = true
				}
			} catch (error) {
				Logger.warn(`[KnowledgeGraphService] Disabling embeddings due to failure in addKnowledge: ${error}`)
				this.isEmbeddingDisabled = true
			}
		}

		await this._push({
			type: "insert",
			table: "agent_knowledge",
			values: {
				id,
				userId: "default",
				streamId,
				type,
				content,
				tags: JSON.stringify(options.tags || []),
				embedding: embedding ? JSON.stringify(embedding) : null,
				confidence: options.confidence ?? 1.0,
				hubScore: 0,
				expiresAt: options.expiresAt || null,
				metadata: JSON.stringify({
					...options.metadata,
					hash: this.calculateHash(content),
					mtime: options.metadata?.mtime || new Date().toISOString().split("T")[0],
					size: options.metadata?.size || Buffer.byteLength(content),
				}),
				createdAt: Date.now(),
			},
			layer: "domain",
		})

		return id
	}

	/**
	 * Creates a cognitive snapshot, potentially landmarking history if it's too deep.
	 */
	async cognitiveSnapshot(streamId: string, content: string, count: number): Promise<string> {
		const id = nanoid()
		let landmarkId: string | undefined

		if (count > 20) {
			landmarkId = await this.createLandmark(streamId, content, count)
		}

		await this._push({
			type: "insert",
			table: "agent_cognitive_snapshots",
			values: {
				id,
				streamId,
				content,
				embedding: "[]", // Simplified
				metadata: landmarkId ? JSON.stringify({ landmarkId }) : null,
				createdAt: Date.now(),
			},
			layer: "domain",
		})

		return id
	}

	/**
	 * Append a long-term directive or context string to the agent's persistent Memory Layer.
	 */
	async appendMemoryLayer(streamId: string, key: string, memory: string): Promise<void> {
		const db = await getDb()
		const existing = await db
			.selectFrom("agent_memory")
			.selectAll()
			.where("streamId", "=", streamId)
			.where("key", "=", key)
			.executeTakeFirst()

		const newValue = existing ? `${existing.value}\n---\n${memory}` : memory

		await this._push({
			type: existing ? "update" : "insert",
			table: "agent_memory",
			where: existing
				? [
						{ column: "streamId", value: streamId },
						{ column: "key", value: key },
					]
				: undefined,
			values: {
				streamId,
				key,
				value: newValue,
				updatedAt: Date.now(),
			},
			layer: "domain",
		})
	}

	/**
	 * Partially update a knowledge graph node.
	 */
	async updateKnowledge(id: string, patch: Partial<KnowledgeNode>): Promise<void> {
		const values: any = { ...patch }
		if (patch.tags) values.tags = JSON.stringify(patch.tags)
		if (patch.embedding) values.embedding = JSON.stringify(patch.embedding)
		if (patch.metadata) values.metadata = JSON.stringify(patch.metadata)

		await this._push({
			type: "update",
			table: "agent_knowledge",
			where: [{ column: "id", value: id }],
			values,
			layer: "domain",
		})
	}

	/**
	 * Fetch a holistic intelligence bundle containing an agent profile, its active tasks, and recent unexpired graph nodes.
	 */
	async getAgentBundle(streamId: string): Promise<{
		stream: Schema["agent_streams"] | null
		tasks: Schema["agent_tasks"][]
		memories: Schema["agent_memory"][]
		recentKnowledge: KnowledgeNode[]
	}> {
		const db = await getDb()
		const stream = await dbPool.selectOne("agent_streams", [{ column: "id", value: streamId }])
		const tasks = await db.selectFrom("agent_tasks").selectAll().where("streamId", "=", streamId).execute()
		const memories = await db.selectFrom("agent_memory").selectAll().where("streamId", "=", streamId).execute()
		const recentKnowledgeRows = await db
			.selectFrom("agent_knowledge")
			.selectAll()
			.where("streamId", "=", streamId)
			.orderBy("createdAt", "desc")
			.limit(50)
			.execute()

		const recentKnowledge = recentKnowledgeRows.map((n) => ({
			...n,
			tags: JSON.parse(n.tags || "[]"),
			embedding: n.embedding ? JSON.parse(n.embedding) : null,
			metadata: n.metadata ? JSON.parse(n.metadata) : null,
			createdAt: Number(n.createdAt),
			confidence: Number(n.confidence),
			hubScore: Number(n.hubScore),
		}))

		return { stream, tasks, memories, recentKnowledge }
	}

	/**
	 * Creates a landmark node (summary of past context) using AI compaction.
	 */
	async createLandmark(streamId: string, content: string, originalCount: number): Promise<string> {
		// Landmark summarized using generic ApiHandler is handled elsewhere or we fallback to Gemini summarize if available
		const summary = (this.embeddingHandler as any).summarizeText
			? await (this.embeddingHandler as any).summarizeText(content)
			: `${content.substring(0, 500)}...`
		return this.addKnowledge(streamId, "landmark", summary, {
			tags: ["memory_summary", "landmark"],
			metadata: { originalCount, type: "cognitive_landmark" },
		})
	}

	async addEdge(sourceId: string, targetId: string, type: string, weight = 1.0): Promise<void> {
		const ops: WriteOp[] = [
			{
				type: "insert",
				table: "agent_knowledge_edges",
				values: {
					sourceId,
					targetId,
					type,
					weight,
					createdAt: Date.now(),
				},
				layer: "domain",
			},
			{
				type: "update",
				table: "agent_knowledge",
				where: [{ column: "id", value: [sourceId, targetId], operator: "IN" }],
				values: {
					hubScore: BufferedDbPool.increment(1),
				},
				layer: "domain",
			},
		]

		await dbPool.pushBatch(ops)
	}

	async traverseGraph(startId: string, maxDepth = 2, filter?: GraphTraversalFilter): Promise<KnowledgeNode[]> {
		const visited = new Set<string>()
		const results: KnowledgeNode[] = []
		const db = await getDb()

		let currentLevelIds = [startId]
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nextLevelIds = new Set<string>()
			const idsToFetch = currentLevelIds.filter((id) => !visited.has(id))

			if (idsToFetch.length === 0) break

			const nodes = await db.selectFrom("agent_knowledge").selectAll().where("id", "in", idsToFetch).execute()

			for (const node of nodes) {
				visited.add(node.id)
				const formattedNode: KnowledgeNode = {
					...node,
					tags: JSON.parse(node.tags || "[]"),
					embedding: node.embedding ? JSON.parse(node.embedding) : null,
					metadata: node.metadata ? JSON.parse(node.metadata) : null,
					createdAt: Number(node.createdAt),
					confidence: Number(node.confidence),
					hubScore: Number(node.hubScore),
				}
				results.push(formattedNode)

				if (depth < maxDepth) {
					let query = db.selectFrom("agent_knowledge_edges").select("targetId").select("sourceId")

					const direction = filter?.direction || "outbound"
					if (direction === "outbound") {
						query = query.where("sourceId", "=", node.id)
					} else if (direction === "inbound") {
						query = query.where("targetId", "=", node.id)
					} else {
						query = query.where((eb) => eb.or([eb("sourceId", "=", node.id), eb("targetId", "=", node.id)]))
					}

					if (filter?.edgeTypes) {
						query = query.where("type", "in", filter.edgeTypes)
					}
					if (filter?.minWeight) {
						query = query.where("weight", ">=", filter.minWeight)
					}

					const edges = await query.execute()
					edges.forEach((e) => {
						const neighborId = e.sourceId === node.id ? e.targetId : e.sourceId
						if (!visited.has(neighborId)) nextLevelIds.add(neighborId)
					})
				}
			}
			currentLevelIds = Array.from(nextLevelIds)
		}

		return results
	}

	/**
	 * Search knowledge graph nodes.
	 */
	async searchKnowledge(
		streamId: string,
		query: string,
		options: {
			tags?: string[]
			limit?: number
			augmentWithGraph?: boolean
			maxDepth?: number
		} = {},
	): Promise<(KnowledgeNode & { similarity: number })[]> {
		const limit = options.limit || 5
		let queryEmbedding: number[] | null = null

		if (!this.isEmbeddingDisabled) {
			try {
				queryEmbedding = await this.embeddingHandler.embedText(query)
			} catch (error) {
				Logger.warn(`[KnowledgeGraphService] Disabling embeddings due to error: ${error}`)
				this.isEmbeddingDisabled = true
			}
		}

		const db = await getDb()
		let queryBuilder = db.selectFrom("agent_knowledge").selectAll().where("streamId", "=", streamId)

		if (options.tags && options.tags.length > 0) {
			// Basic tag filtering: node must have at least one of the tags
			// Since tags are stored as JSON string, we use LIKE for simple implementation
			options.tags.forEach((tag) => {
				queryBuilder = queryBuilder.where("tags", "like", `%${tag}%`)
			})
		}

		// If no embedding available, fall back to keyword search
		if (!queryEmbedding) {
			queryBuilder = queryBuilder.where((eb) =>
				eb.or([eb("content", "like", `%${query}%`), eb("tags", "like", `%${query}%`)]),
			)
		}

		const nodes = await queryBuilder.execute()

		const ranked = nodes
			.map((n) => {
				const embedding = n.embedding ? (JSON.parse(n.embedding) as number[]) : null
				const hubBoost = (Number(n.hubScore) || 0) * 0.01

				let similarity = 0
				if (queryEmbedding && embedding) {
					similarity = this.cosineSimilarity(queryEmbedding, embedding)
				} else {
					// Fallback keyword similarity
					const contentMatch = (n.content || "").toLowerCase().includes(query.toLowerCase())
					const tagMatch = (n.tags || "").toLowerCase().includes(query.toLowerCase())
					if (contentMatch || tagMatch) {
						similarity = 0.5 // Base similarity for keyword match
						if (tagMatch) similarity += 0.1
					}
				}

				return {
					...n,
					userId: n.userId,
					expiresAt: n.expiresAt ? Number(n.expiresAt) : null,
					tags: JSON.parse(n.tags || "[]"),
					embedding,
					metadata: n.metadata ? JSON.parse(n.metadata) : null,
					similarity: similarity + hubBoost,
					createdAt: Number(n.createdAt),
					confidence: Number(n.confidence),
					hubScore: Number(n.hubScore),
				}
			})
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit)

		const finalResults = ranked

		if (options.augmentWithGraph && ranked.length > 0) {
			const augmentedIds = new Set(ranked.map((r) => r.id))
			for (const root of ranked) {
				const neighbors = await this.traverseGraph(root.id, options.maxDepth || 1)
				neighbors.forEach((n) => {
					if (!augmentedIds.has(n.id)) {
						augmentedIds.add(n.id)
						finalResults.push({
							...n,
							userId: (n as any).userId || "default",
							expiresAt: (n as any).expiresAt || null,
							similarity: root.similarity * 0.8,
						} as any) // Decay similarity for neighbors
					}
				})
			}
		}

		return finalResults.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
	}

	/**
	 * Deletes a knowledge node and its edges.
	 */
	async deleteKnowledge(id: string): Promise<void> {
		const ops: WriteOp[] = [
			{ type: "delete", table: "agent_knowledge", where: [{ column: "id", value: id }], layer: "domain" },
			{
				type: "delete",
				table: "agent_knowledge_edges",
				where: [{ column: "sourceId", value: id }],
				layer: "domain",
			},
			{
				type: "delete",
				table: "agent_knowledge_edges",
				where: [{ column: "targetId", value: id }],
				layer: "domain",
			},
		]
		await dbPool.pushBatch(ops)
	}

	/**
	 * Merges two knowledge nodes, folding source into target.
	 */
	async mergeKnowledge(sourceId: string, targetId: string): Promise<void> {
		const db = await getDb()
		const source = await db.selectFrom("agent_knowledge").selectAll().where("id", "=", sourceId).executeTakeFirst()
		const target = await db.selectFrom("agent_knowledge").selectAll().where("id", "=", targetId).executeTakeFirst()

		if (!source || !target) throw new Error("Source or target node not found")

		const sourceTags = JSON.parse(source.tags || "[]")
		const targetTags = JSON.parse(target.tags || "[]")
		const combinedTags = Array.from(new Set([...sourceTags, ...targetTags]))

		const sourceMetadata = JSON.parse(source.metadata || "{}")
		const targetMetadata = JSON.parse(target.metadata || "{}")
		const combinedMetadata = { ...targetMetadata, ...sourceMetadata, mergedFrom: sourceId }

		const combinedContent = `${target.content}\n---\n[Merged from ${sourceId}]\n${source.content}`

		await this._push({
			type: "update",
			table: "agent_knowledge",
			where: [{ column: "id", value: targetId }],
			values: {
				content: combinedContent,
				tags: JSON.stringify(combinedTags),
				metadata: JSON.stringify(combinedMetadata),
				confidence: Math.max(Number(source.confidence), Number(target.confidence)),
			},
			layer: "domain",
		})

		// Re-point edges
		await this._push({
			type: "update",
			table: "agent_knowledge_edges",
			where: [{ column: "targetId", value: sourceId }],
			values: { targetId },
			layer: "domain",
		})

		await this._push({
			type: "update",
			table: "agent_knowledge_edges",
			where: [{ column: "sourceId", value: sourceId }],
			values: { sourceId: targetId },
			layer: "domain",
		})

		// Delete source node
		await this.deleteKnowledge(sourceId)
	}

	/**
	 * Extract a self-contained serializable subgraph from a root node.
	 */
	async extractSubgraph(
		rootId: string,
		maxDepth = 2,
		filter?: GraphTraversalFilter,
	): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
		const nodes = await this.traverseGraph(rootId, maxDepth, filter)
		const nodeIds = nodes.map((n) => n.id)
		const db = await getDb()

		const edges = await db
			.selectFrom("agent_knowledge_edges")
			.selectAll()
			.where("sourceId", "in", nodeIds)
			.where("targetId", "in", nodeIds)
			.execute()

		return {
			nodes,
			edges: edges.map((e) => ({
				...e,
				weight: Number(e.weight),
				createdAt: Number(e.createdAt),
			})),
		}
	}

	/**
	 * Refreshes confidence and usage markers of a node.
	 */
	async refreshKnowledge(id: string): Promise<void> {
		await this._push({
			type: "update",
			table: "agent_knowledge",
			where: [{ column: "id", value: id }],
			values: { confidence: 1.0 },
			layer: "domain",
		})
	}

	/**
	 * Get degree centrality metrics for a node.
	 */
	async getNodeCentrality(id: string): Promise<{ kbId: string; inbound: number; outbound: number; totalDegree: number }> {
		const db = await getDb()
		const outboundRows = await db.selectFrom("agent_knowledge_edges").where("sourceId", "=", id).execute()
		const inboundRows = await db.selectFrom("agent_knowledge_edges").where("targetId", "=", id).execute()

		return {
			kbId: id,
			outbound: outboundRows.length,
			inbound: inboundRows.length,
			totalDegree: outboundRows.length + inboundRows.length,
		}
	}

	/**
	 * Decay confidence of nodes older than a certain date.
	 */
	async decayConfidence(factor: number, olderThanMs: number): Promise<{ decayedCount: number }> {
		const db = await getDb()
		const rows = await db
			.selectFrom("agent_knowledge")
			.select(["id", "confidence"])
			.where("createdAt", "<", olderThanMs)
			.execute()

		let decayedCount = 0
		for (const row of rows) {
			const newConfidence = Math.max(0, Number(row.confidence) * factor)
			await db.updateTable("agent_knowledge").set({ confidence: newConfidence }).where("id", "=", row.id).execute()
			decayedCount++
		}

		return { decayedCount }
	}

	/**
	 * Gets the history of snapshots for a stream.
	 */
	async getHistory(streamId: string, limit = 200): Promise<KnowledgeNode[]> {
		const db = await getDb()
		const nodes = await db
			.selectFrom("agent_knowledge")
			.selectAll()
			.where("streamId", "=", streamId)
			.where("type", "=", "snapshot")
			.orderBy("createdAt", "desc")
			.limit(limit)
			.execute()

		return nodes.map((n) => ({
			...n,
			tags: JSON.parse(n.tags || "[]"),
			embedding: n.embedding ? JSON.parse(n.embedding) : null,
			metadata: n.metadata ? JSON.parse(n.metadata) : null,
			createdAt: Number(n.createdAt),
			confidence: Number(n.confidence),
			hubScore: Number(n.hubScore),
		}))
	}

	/**
	 * Semantic Context Routing: Analyzes history to find files frequently co-modified with the target file.
	 */
	async getContextGraph(streamId: string, filePath: string, limit = 50): Promise<{ path: string; weight: number }[]> {
		const history = await this.getHistory(streamId, 200)
		const normalizedTarget = filePath.replace(/^\/+/, "").replace(/\/\/+/g, "/")
		const correlations: Record<string, number> = {}

		for (let i = 0; i < history.length - 1; i++) {
			const curr = history[i]!
			const prev = history[i + 1]!
			const currTree = curr.metadata?.tree || {}
			const prevTree = prev.metadata?.tree || {}

			const changedFiles = new Set<string>()
			for (const p of Object.keys(currTree)) if (currTree[p] !== prevTree[p]) changedFiles.add(p)
			for (const p of Object.keys(prevTree)) if (!(p in currTree)) changedFiles.add(p)

			if (changedFiles.has(normalizedTarget)) {
				changedFiles.delete(normalizedTarget)
				for (const cochanged of changedFiles) {
					correlations[cochanged] = (correlations[cochanged] || 0) + 1
				}
			}
		}

		return Object.entries(correlations)
			.map(([path, weight]) => ({ path, weight }))
			.sort((a, b) => b.weight - a.weight)
			.slice(0, limit)
	}

	/**
	 * Recursive Semantic Impact Analysis: Walks history to find dependencies.
	 */
	async calculateBlastRadius(streamId: string, filePath: string, maxDepth = 2): Promise<{ path: string; depth: number }[]> {
		const radius = new Map<string, number>()
		const queue: { path: string; depth: number }[] = [{ path: filePath, depth: 0 }]
		radius.set(filePath, 0)

		const history = await this.getHistory(streamId, 200)

		while (queue.length > 0) {
			const current = queue.shift()!
			if (current.depth >= maxDepth) continue

			const correlations: Record<string, number> = {}
			const normalizedTarget = current.path.replace(/^\/+/, "").replace(/\/\/+/g, "/")

			for (let i = 0; i < history.length - 1; i++) {
				const curr = history[i]!
				const prev = history[i + 1]!
				const currTree = curr.metadata?.tree || {}
				const prevTree = prev.metadata?.tree || {}

				const changedFiles = new Set<string>()
				for (const p of Object.keys(currTree)) if (currTree[p] !== prevTree[p]) changedFiles.add(p)
				for (const p of Object.keys(prevTree)) if (!(p in currTree)) changedFiles.add(p)

				if (changedFiles.has(normalizedTarget)) {
					changedFiles.delete(normalizedTarget)
					for (const cochanged of changedFiles) {
						correlations[cochanged] = (correlations[cochanged] || 0) + 1
					}
				}
			}

			for (const [coPath, weight] of Object.entries(correlations)) {
				if (weight >= 2 && !radius.has(coPath)) {
					radius.set(coPath, current.depth + 1)
					queue.push({ path: coPath, depth: current.depth + 1 })
				}
			}

			// V9: Enhance with explicit Graph Edges
			const db = await getDb()
			const nodes = await db
				.selectFrom("agent_knowledge")
				.selectAll()
				.where("content", "like", `%${normalizedTarget}%`) // Match filename in content/metadata
				.execute()

			for (const node of nodes) {
				const edges = await db.selectFrom("agent_knowledge_edges").selectAll().where("sourceId", "=", node.id).execute()

				for (const edge of edges) {
					const targetNode = await db
						.selectFrom("agent_knowledge")
						.selectAll()
						.where("id", "=", edge.targetId)
						.executeTakeFirst()

					if (targetNode) {
						// Extract a path-like string from targetNode content or metadata if possible
						const targetPath = targetNode.content.split("\n")[0]?.trim() || targetNode.id
						if (targetPath && !radius.has(targetPath)) {
							radius.set(targetPath, current.depth + 1)
							queue.push({ path: targetPath, depth: current.depth + 1 })
						}
					}
				}
			}
		}

		return Array.from(radius.entries())
			.map(([path, depth]) => ({ path, depth }))
			.filter((item) => item.depth > 0)
			.sort((a, b) => a.depth - b.depth)
	}

	/**
	 * Detects architectural chokepoints based on churn and contention.
	 */
	async detectChokepoints(streamId: string, limit = 10): Promise<{ path: string; score: number; churn: number }[]> {
		const history = await this.getHistory(streamId, 300)
		const stats: Record<string, { churn: number }> = {}

		for (let i = 0; i < history.length - 1; i++) {
			const curr = history[i]!
			const prev = history[i + 1]!
			const currTree = curr.metadata?.tree || {}
			const prevTree = prev.metadata?.tree || {}

			for (const p of Object.keys(currTree)) {
				if (currTree[p] !== prevTree[p]) {
					if (!stats[p]) stats[p] = { churn: 0 }
					stats[p]!.churn++
				}
			}
		}

		return Object.entries(stats)
			.map(([path, data]) => ({
				path,
				churn: data.churn,
				score: data.churn, // In this integration, we simplify since we don't have multi-author metadata easily available
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
	}

	/**
	 * Self-Healing: Recovers the last known state of a file.
	 */
	async recoverFile(streamId: string, filePath: string): Promise<{ content: string; sourceId: string } | null> {
		const history = await this.getHistory(streamId, 300)
		const normalizedPath = filePath.replace(/^\/+/, "").replace(/\/\/+/g, "/")

		for (const snapshot of history) {
			const tree = snapshot.metadata?.tree || {}
			if (normalizedPath in tree) {
				return {
					content: snapshot.content,
					sourceId: snapshot.id,
				}
			}
		}
		return null
	}

	/**
	 * Identify the last agent and commit that modified a specific file.
	 */
	async blame(
		streamId: string,
		filePath: string,
	): Promise<{ lastAuthor: string; lastNodeId: string; lastMessage: string; lastTimestamp: number } | null> {
		const history = await this.getHistory(streamId, 300)
		const normalizedPath = filePath.replace(/^\/+/, "").replace(/\/\/+/g, "/")

		for (let i = 0; i < history.length - 1; i++) {
			const curr = history[i]!
			const prev = history[i + 1]!
			const currTree = curr.metadata?.tree || {}
			const prevTree = prev.metadata?.tree || {}

			if (currTree[normalizedPath] && currTree[normalizedPath] !== prevTree[normalizedPath]) {
				return {
					lastAuthor: (curr as any).userId || "agent",
					lastNodeId: curr.id,
					lastMessage: curr.content.substring(0, 100),
					lastTimestamp: curr.createdAt,
				}
			}
		}
		return null
	}

	/**
	 * Generates a high-level, structural changelog between two references (snapshots).
	 */
	async generateChangelog(streamId: string, baseId: string, headId: string): Promise<string> {
		const _db = await getDb()
		const history = await this.getHistory(streamId, 500)

		const headNode = history.find((n) => n.id === headId)
		const baseNode = history.find((n) => n.id === baseId)

		if (!headNode || !baseNode) return "Base or Head snapshot not found in history."

		const baseTree = baseNode.metadata?.tree || {}
		const headTree = headNode.metadata?.tree || {}

		const added: string[] = []
		const removed: string[] = []
		const modified: string[] = []

		for (const f of Object.keys(headTree)) {
			if (!(f in baseTree)) added.push(f)
			else if (headTree[f] !== baseTree[f]) modified.push(f)
		}
		for (const f of Object.keys(baseTree)) {
			if (!(f in headTree)) removed.push(f)
		}

		return `REGULATORY CHANGELOG: ${baseId.substring(0, 7)} -> ${headId.substring(0, 7)}
Total Files Added: ${added.length}
Total Files Modified: ${modified.length}
Total Files Removed: ${removed.length}

Added: ${added.join(", ") || "None"}
Modified: ${modified.join(", ") || "None"}
Removed: ${removed.join(", ") || "None"}
`
	}

	/**
	 * Speculative Merge Forecasting: Predicts conflicts using graph diffing.
	 */
	async simulateMerge(
		sourceStreamId: string,
		targetStreamId: string,
	): Promise<{ hasConflicts: boolean; affectedPaths: string[] }> {
		const sourceHistory = await this.getHistory(sourceStreamId, 50)
		const targetHistory = await this.getHistory(targetStreamId, 50)

		if (sourceHistory.length === 0 || targetHistory.length === 0) {
			return { hasConflicts: false, affectedPaths: [] }
		}

		// Find LCA
		const sourceIds = new Set(sourceHistory.map((n) => n.id))
		let lcaId: string | null = null
		let lcaTree: Record<string, string> = {}

		for (const node of targetHistory) {
			if (sourceIds.has(node.id)) {
				lcaId = node.id
				lcaTree = node.metadata?.tree || {}
				break
			}
		}

		const sourceTree = sourceHistory[0]?.metadata?.tree || {}
		const targetTree = targetHistory[0]?.metadata?.tree || {}
		const affectedPaths: string[] = []
		let hasConflicts = false

		const allPaths = new Set([...Object.keys(sourceTree), ...Object.keys(targetTree)])

		for (const path of allPaths) {
			const s = sourceTree[path]
			const t = targetTree[path]
			const base = lcaTree[path]

			if (s !== t) {
				affectedPaths.push(path)

				// Real conflict detection: changed in both relative to LCA
				if (lcaId) {
					const changedInSource = s !== base
					const changedInTarget = t !== base
					if (changedInSource && changedInTarget) {
						hasConflicts = true
					}
				} else {
					// If no LCA, any difference is a potential conflict
					if (s && t) {
						hasConflicts = true
					}
				}
			}
		}

		return {
			hasConflicts,
			affectedPaths,
		}
	}

	/**
	 * V9: Speculative Merge Forecasting.
	 * Predicts semantic conflicts by intersecting blast radii of changes.
	 */
	async simulateMergeForecast(
		sourceStreamId: string,
		targetStreamId: string,
	): Promise<{
		isHighRisk: boolean
		conflicts: string[]
		semanticOverlaps: { path: string; reason: string }[]
	}> {
		const mergeSim = await this.simulateMerge(sourceStreamId, targetStreamId)
		const semanticOverlaps: { path: string; reason: string }[] = []

		// 1. Calculate blast radii for all affected files in source
		const sourceRadii = new Map<string, number>()
		for (const path of mergeSim.affectedPaths) {
			const radius = await this.calculateBlastRadius(sourceStreamId, path, 2)
			for (const item of radius) sourceRadii.set(item.path, item.depth)
		}

		// 2. Identify files changed in the target stream
		const targetHistory = await this.getHistory(targetStreamId, 50)
		const targetChangedPaths = new Set<string>()
		if (targetHistory.length > 1) {
			const targetHead = targetHistory[0]?.metadata?.tree || {}
			const targetBase = targetHistory[targetHistory.length - 1]?.metadata?.tree || {}
			for (const path of Object.keys(targetHead)) {
				if (targetHead[path] !== targetBase[path]) {
					targetChangedPaths.add(path)
				}
			}
		}

		// 3. Calculate full blast radii for target stream changes
		const targetRadii = new Map<string, number>()
		for (const path of targetChangedPaths) {
			const radius = await this.calculateBlastRadius(targetStreamId, path, 2)
			for (const item of radius) targetRadii.set(item.path, item.depth)
		}

		// 4. Compute genuine structural intersection of blast radii (Real semantic overlap)
		for (const [sourcePath, sourceDepth] of sourceRadii.entries()) {
			if (targetRadii.has(sourcePath)) {
				const targetDepth = targetRadii.get(sourcePath)!
				semanticOverlaps.push({
					path: sourcePath,
					reason: `Semantic overlap: Multi-hop structural intersection (Source depth: ${sourceDepth}, Target depth: ${targetDepth})`,
				})
			}
		}

		// 5. Also include direct intersections with the active target task context if nodes exist
		const targetContext = await this.getTaskContext(targetStreamId).catch(() => null)
		if (targetContext) {
			for (const node of targetContext.resolvedGraph) {
				const nodePath = node.content.split("\n")[0]?.trim()
				if (nodePath && sourceRadii.has(nodePath) && !targetRadii.has(nodePath)) {
					semanticOverlaps.push({
						path: nodePath,
						reason: `Semantic overlap: Source radius intersects with locked target context`,
					})
				}
			}
		}

		return {
			isHighRisk: semanticOverlaps.length > 0 || mergeSim.hasConflicts,
			conflicts: mergeSim.affectedPaths, // Direct conflicts
			semanticOverlaps,
		}
	}

	/**
	 * Spawns a new sub-task and links it to specific high-value knowledge nodes.
	 */
	async spawnTask(streamId: string, description: string, complexity = 1.0, linkedKnowledgeIds: string[] = []): Promise<string> {
		const id = nanoid()
		await this._push({
			type: "insert",
			table: "agent_tasks",
			values: {
				id,
				streamId,
				description,
				status: "pending",
				result: null,
				complexity,
				linkedKnowledgeIds: JSON.stringify(linkedKnowledgeIds),
				metadata: null,
				createdAt: Date.now(),
			},
			layer: "domain",
		})

		// Link sub-task to the linked knowledge nodes in the graph
		for (const kbId of linkedKnowledgeIds) {
			try {
				const node = await dbPool.selectOne("agent_knowledge", [{ column: "id", value: kbId }])
				if (node) {
					// We conceptually "link" the task to the knowledge via a ghost edge in context
					// or by simply ensuring the agent can see it in its bundle.
				}
			} catch (_e) {
				// Ignore missing nodes
			}
		}

		return id
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		let dotProduct = 0
		let mA = 0
		let mB = 0
		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i]
			mA += a[i] * a[i]
			mB += b[i] * b[i]
		}
		mA = Math.sqrt(mA)
		mB = Math.sqrt(mB)
		if (mA === 0 || mB === 0) return 0
		return dotProduct / (mA * mB)
	}

	/**
	 * Returns top N hubs by centrality score.
	 */
	async getGlobalCentrality(limit = 10): Promise<any[]> {
		const db = await getDb()
		const rows = await db.selectFrom("agent_knowledge").selectAll().orderBy("hubScore", "desc").limit(limit).execute()

		return rows.map((r) => ({
			kbId: r.id,
			score: Number(r.hubScore) || 0,
			content: r.content.substring(0, 200),
		}))
	}

	/**
	 * Resolves the context for a task, including multi-hop graph neighborhood.
	 */
	async getTaskContext(taskId: string): Promise<any> {
		try {
			const db = await getDb()
			const task = await db.selectFrom("agent_tasks").selectAll().where("id", "=", taskId).executeTakeFirst()
			if (!task) return { task: null, resolvedGraph: [] }

			const linkedKnowledgeIds = JSON.parse(task.linkedKnowledgeIds || "[]")
			const resolvedGraph: any[] = []

			if (linkedKnowledgeIds.length > 0) {
				const graphPromises = linkedKnowledgeIds.map((kbId: string) => this.traverseGraph(kbId, 2))
				const nestedResults = await Promise.all(graphPromises)

				const seen = new Set<string>()
				for (const results of nestedResults) {
					for (const item of results as any[]) {
						if (!seen.has(item.id)) {
							seen.add(item.id)
							resolvedGraph.push(item)
						}
					}
				}
			}

			return { task, resolvedGraph }
		} catch (error) {
			Logger.warn(`[KnowledgeGraphService] Failed to resolve task context: ${error}`)
			return { task: null, resolvedGraph: [] }
		}
	}
}
