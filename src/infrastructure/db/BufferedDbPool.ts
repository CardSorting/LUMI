import * as crypto from "node:crypto"
import type Database from "better-sqlite3"
import { type Kysely, sql, type Transaction } from "kysely"
import { Logger } from "@/shared/services/Logger"
import { getDb, getRawDb, type Schema } from "./Config"

// Production-grade Mutex implementation
class Mutex {
	private queue: (() => void)[] = []
	private locked = false

	constructor(public name: string) {}

	async acquire(): Promise<() => void> {
		if (!this.locked) {
			this.locked = true
			return () => this.release()
		}

		return new Promise((resolve) => {
			this.queue.push(() => resolve(() => this.release()))
		})
	}

	private release() {
		const next = this.queue.shift()
		if (next) {
			next()
		} else {
			this.locked = false
		}
	}
}

export type DbLayer = "domain" | "infrastructure" | "ui" | "plumbing"

type WhereCondition = {
	column: string
	value: string | number | string[] | number[] | null
	operator?: "=" | "<" | ">" | "<=" | ">=" | "!=" | "IN" | "in" | "In" | "UNSAFE_IN" | "IS" | "IS NOT" | "LIKE"
}

export type Increment = { _type: "increment"; value: number }

export type WriteOp = {
	type: "insert" | "update" | "delete" | "upsert"
	table: keyof Schema
	values?: Record<string, unknown | Increment>
	where?: WhereCondition | WhereCondition[]
	conflictTarget?: string | string[] // For upserts
	agentId?: string
	layer?: DbLayer
	// Level 6: Pre-calculated Metadata
	hasIncrements?: boolean
	dedupKey?: string
}

const LAYER_PRIORITY: Record<DbLayer, number> = {
	domain: 0,
	infrastructure: 1,
	ui: 2,
	plumbing: 3,
}

function normalizeWhere(where: WhereCondition | WhereCondition[] | undefined): WhereCondition[] {
	if (!where) return []
	return Array.isArray(where) ? where : [where]
}

/**
 * BufferedDbPool provides a high-performance, asynchronous write-behind layer
 * over SQLite. It batches operations, manages agent-specific uncommitted state,
 * and ensures data consistency between in-memory buffers and on-disk storage.
 */
export class BufferedDbPool {
	private bufferA = new Map<keyof Schema, WriteOp[]>()
	private bufferB = new Map<keyof Schema, WriteOp[]>()
	private activeBuffer: Map<keyof Schema, WriteOp[]> = this.bufferA
	private inFlightOps: Map<keyof Schema, WriteOp[]> = new Map()
	private agentShadows = new Map<string, { ops: WriteOp[]; affectedFiles: Set<string>; lastUpdated: number }>()
	private stateMutex = new Mutex("DbStateMutex")
	private flushMutex = new Mutex("DbFlushMutex")
	private flushInterval: NodeJS.Timeout | null = null
	private db: Kysely<Schema> | null = null
	private rawDb: Database.Database | null = null
	private totalTransactions = 0
	private stmtCache = new Map<string, Database.Statement>()
	private parameterBuffer = new Array(2000) // Pre-allocated for chunked inserts
	private activeBufferSize = 0
	private inFlightSize = 0
	// Level 7: Event Horizon Status Index (O(1) Query Mapping)
	private activeIndex = new Map<keyof Schema, Map<string, Set<WriteOp>>>()
	private inFlightIndex = new Map<keyof Schema, Map<string, Set<WriteOp>>>()
	private warmedIndices = new Set<string>() // Level 9: Authoritative Memory Indices

	constructor() {
		this.startFlushLoop()
	}

	private flushTimeout: NodeJS.Timeout | null = null
	private currentFlushDelay: number | null = null

	/**
	 * Adaptive flush scheduling.
	 */
	private scheduleFlush(delay = 10) {
		if (this.flushTimeout) {
			if (this.currentFlushDelay !== null && this.currentFlushDelay <= delay) {
				return
			}
			clearTimeout(this.flushTimeout)
		}

		this.currentFlushDelay = delay
		this.flushTimeout = setTimeout(async () => {
			this.currentFlushDelay = null
			this.flushTimeout = null
			try {
				await this.flush()
			} finally {
				const release = await this.stateMutex.acquire()
				try {
					let hasData = false
					for (const ops of this.activeBuffer.values()) {
						if (ops.length > 0) {
							hasData = true
							break
						}
					}
					if (hasData) {
						this.scheduleFlush(10)
					}
				} finally {
					release()
				}
			}
		}, delay)
	}

	private cleanupInterval: NodeJS.Timeout | null = null

	private startFlushLoop() {
		this.scheduleFlush(1000)
		this.flushInterval = setInterval(() => this.scheduleFlush(1000), 1000)
		this.cleanupInterval = setInterval(() => this.cleanupShadows(), 30000)
	}

	private async cleanupShadows() {
		const release = await this.stateMutex.acquire()
		try {
			const now = Date.now()
			const SHADOW_EXPIRATION = 5 * 60 * 1000
			for (const [agentId, shadow] of this.agentShadows.entries()) {
				if (now - shadow.lastUpdated > SHADOW_EXPIRATION) {
					this.agentShadows.delete(agentId)
				}
			}
		} finally {
			release()
		}
	}

	public async beginWork(agentId: string) {
		const release = await this.stateMutex.acquire()
		try {
			if (!this.agentShadows.has(agentId)) {
				this.agentShadows.set(agentId, {
					ops: [],
					affectedFiles: new Set(),
					lastUpdated: Date.now(),
				})
			}
		} finally {
			release()
		}
	}

	public async push(op: WriteOp, agentId?: string, affectedFile?: string) {
		return this.pushBatch([op], agentId, affectedFile)
	}

	private async ensureDb(): Promise<Kysely<Schema>> {
		if (!this.db) {
			const db = await getDb()
			await sql`PRAGMA cache_size = -128000;`.execute(db)
			await sql`PRAGMA temp_store = MEMORY;`.execute(db)
			await sql`PRAGMA journal_mode = WAL;`.execute(db)
			await sql`PRAGMA synchronous = NORMAL;`.execute(db)
			await sql`PRAGMA mmap_size = 2147483648;`.execute(db)
			await sql`PRAGMA threads = 4;`.execute(db)
			await sql`PRAGMA auto_vacuum = NONE;`.execute(db)
			this.db = db
			this.rawDb = await getRawDb()
		}
		return this.db
	}

	private getStatement(sqlStr: string): Database.Statement {
		let stmt = this.stmtCache.get(sqlStr)
		if (!stmt && this.rawDb) {
			stmt = this.rawDb.prepare(sqlStr)
			this.stmtCache.set(sqlStr, stmt)
		}
		return stmt!
	}

	private enqueueLatencies: number[] = []
	private processingLatencies: number[] = []
	private MAX_METRICS_SAMPLES = 5000

	private recordLatency(target: number[], value: number) {
		target.push(value)
		if (target.length > this.MAX_METRICS_SAMPLES) {
			target.shift()
		}
	}

	private calculatePercentile(samples: number[], percentile: number): number {
		if (samples.length === 0) return 0
		const sorted = [...samples].sort((a, b) => a - b)
		const index = Math.ceil((percentile / 100) * sorted.length) - 1
		return sorted[index] ?? 0
	}

	public async pushBatch(ops: WriteOp[], agentId?: string, affectedFile?: string) {
		const enqueueStart = performance.now()
		let currentBufferLength = 0

		for (const op of ops) {
			if (agentId) op.agentId = agentId
			this.detectMetadata(op)

			// Level 7: Index maintenance (O(1))
			if ((op.table as string) === "agent_tasks" && op.values && (op.values as any).status) {
				let tableIndex = this.activeIndex.get(op.table)
				if (!tableIndex) {
					tableIndex = new Map()
					this.activeIndex.set(op.table, tableIndex)
				}
				const key = `status:${(op.values as any).status}`
				let set = tableIndex.get(key)
				if (!set) {
					set = new Set()
					tableIndex.set(key, set)
				}
				set.add(op)
			}
		}

		if (agentId) {
			// Level 3 Optimization: Lock-free shadow access
			// Each agent is isolated; we only lock if we need to create the entry for the first time.
			let shadow = this.agentShadows.get(agentId)

			if (!shadow) {
				const release = await this.stateMutex.acquire()
				try {
					shadow = this.agentShadows.get(agentId) ?? {
						ops: [],
						affectedFiles: new Set<string>(),
						lastUpdated: Date.now(),
					}
					this.agentShadows.set(agentId, shadow)
				} finally {
					release()
				}
			}

			// Safe to push without stateMutex because this agentId is unique to this caller
			for (const op of ops) {
				shadow.ops.push({ ...op, agentId })
			}
			if (affectedFile) shadow.affectedFiles.add(affectedFile)
			shadow.lastUpdated = Date.now()
		} else {
			if (ops.length > 0) {
				let tableBuffer = this.activeBuffer.get(ops[0].table)
				if (!tableBuffer) {
					tableBuffer = []
					this.activeBuffer.set(ops[0].table, tableBuffer)
				}
				tableBuffer.push(...ops)
				this.activeBufferSize += ops.length
				currentBufferLength = this.activeBufferSize
			}
		}

		if (currentBufferLength > 100000) {
			Logger.warn(`[DbPool] CRITICAL backpressure: activeBuffer length is ${currentBufferLength}`)
		}

		const shouldFlush = currentBufferLength >= 10000

		this.recordLatency(this.enqueueLatencies, performance.now() - enqueueStart)
		if (shouldFlush) {
			this.scheduleFlush(0)
		} else {
			this.scheduleFlush(5)
		}
	}

	public async commitWork(agentId: string, _validator?: any) {
		let shadowOpsCount = 0
		const release = await this.stateMutex.acquire()
		try {
			const shadow = this.agentShadows.get(agentId)
			this.agentShadows.delete(agentId)
			if (shadow && shadow.ops.length > 0) {
				shadowOpsCount = shadow.ops.length
				for (const op of shadow.ops) {
					let tableBuffer = this.activeBuffer.get(op.table)
					if (!tableBuffer) {
						tableBuffer = []
						this.activeBuffer.set(op.table, tableBuffer)
					}
					tableBuffer.push(op)
					this.activeBufferSize++

					// Level 7: Index maintenance (O(1))
					if ((op.table as string) === "agent_tasks" && op.values && (op.values as any).status) {
						let tableIndex = this.activeIndex.get(op.table)
						if (!tableIndex) {
							tableIndex = new Map()
							this.activeIndex.set(op.table, tableIndex)
						}
						const key = `status:${(op.values as any).status}`
						let set = tableIndex.get(key)
						if (!set) {
							set = new Set()
							tableIndex.set(key, set)
						}
						set.add(op)
					}
				}
			}
		} finally {
			release()
		}

		if (shadowOpsCount > 0) {
			this.scheduleFlush(0)
		}
	}

	public async rollbackWork(agentId: string, _reason?: string) {
		const release = await this.stateMutex.acquire()
		try {
			this.agentShadows.delete(agentId)
		} finally {
			release()
		}
	}

	public async runTransaction<T>(callback: (agentId: string) => Promise<T>): Promise<T> {
		const agentId = `trx-${crypto.randomUUID()}`
		await this.beginWork(agentId)
		try {
			const result = await callback(agentId)
			await this.commitWork(agentId)
			return result
		} catch (e) {
			await this.rollbackWork(agentId)
			throw e
		}
	}

	public async flush() {
		const releaseFlush = await this.flushMutex.acquire()
		let opsToFlush: WriteOp[] = []
		const startTime = Date.now()

		try {
			const releaseState = await this.stateMutex.acquire()
			let hasData = false
			try {
				const dirtyBuffer = this.activeBuffer
				for (const ops of dirtyBuffer.values()) {
					if (ops.length > 0) {
						hasData = true
						break
					}
				}

				if (hasData) {
					// Atomic Swap: Infinite Horizon (Partitioned)
					this.activeBuffer = dirtyBuffer === this.bufferA ? this.bufferB : this.bufferA
					this.activeBuffer.clear() // Reset the new active buffer map
					this.inFlightSize = this.activeBufferSize
					this.activeBufferSize = 0

					this.inFlightOps = dirtyBuffer

					// Level 7: Index Swap
					this.inFlightIndex = this.activeIndex
					this.activeIndex = new Map()

					opsToFlush = Array.from(dirtyBuffer.values())
						.flat()
						.sort((a, b) => {
							const pA = (LAYER_PRIORITY as any)[a.layer ?? "plumbing"]
							const pB = (LAYER_PRIORITY as any)[b.layer ?? "plumbing"]
							if (pA !== pB) return pA - pB
							if (a.table !== b.table) return (a.table as string).localeCompare(b.table as string)
							return (a.type as string).localeCompare(b.type as string)
						})
				} else if (this.inFlightOps.size > 0) {
					opsToFlush = Array.from(this.inFlightOps.values()).flat()
				}
			} finally {
				releaseState()
			}

			if (opsToFlush.length === 0) return

			const db = await this.ensureDb()
			let totalFlushed = 0
			this.totalTransactions++

			await db.transaction().execute(async (trx) => {
				const processedGroups = this.groupOps(opsToFlush)

				for (const group of processedGroups) {
					const first = group[0]
					if (!first) continue
					const table = first.table

					// High-Performance Path: Chunked Raw SQL (Level 3 Quantum Boost)
					if (group.length >= 100 && first.type === "insert" && this.rawDb) {
						totalFlushed += await this.executeChunkedRawInsert(table, group)
					} else if (group.length > 1 && first.type === "insert") {
						totalFlushed += await this.executeBulkInsert(trx as any, table, group)
					} else if (group.length > 1 && first.type === "update") {
						totalFlushed += await this.executeBulkUpdate(trx as any, table, group)
					} else {
						for (const op of group) {
							await this.executeSingleOp(trx as any, op)
							totalFlushed++
						}
					}
				}
			})

			const duration = Date.now() - startTime
			this.recordLatency(this.processingLatencies, duration)

			const throughput = Math.round(totalFlushed / (duration / 1000 || 0.001))
			if (duration > 50 || totalFlushed > 1000) {
				const p95p = this.calculatePercentile(this.processingLatencies, 95)
				const p99p = this.calculatePercentile(this.processingLatencies, 99)
				const p95e = this.calculatePercentile(this.enqueueLatencies, 95)
				Logger.info(
					`[DbPool] Flush: ${totalFlushed} ops in ${duration}ms (${throughput} ops/sec) | Latency: p95_proc=${p95p.toFixed(1)}ms, p99_proc=${p99p.toFixed(1)}ms, p95_enq=${p95e.toFixed(2)}ms`,
				)
			}

			const releaseStateClear = await this.stateMutex.acquire()
			try {
				this.inFlightOps.clear()
				this.inFlightSize = 0
				this.inFlightIndex.clear()
			} finally {
				releaseStateClear()
			}
		} catch (e: unknown) {
			const err = e as { code?: string; message?: string }
			const isRetryable = err.code === "SQLITE_BUSY" || err.code === "SQLITE_LOCKED" || err.message?.includes("deadlock")

			const releaseStateFail = await this.stateMutex.acquire()
			try {
				if (isRetryable) {
					for (const op of opsToFlush) {
						let tableBuffer = this.activeBuffer.get(op.table)
						if (!tableBuffer) {
							tableBuffer = []
							this.activeBuffer.set(op.table, tableBuffer)
						}
						tableBuffer.unshift(op)
						this.activeBufferSize++

						// Level 7: Restore index
						if ((op.table as string) === "agent_tasks" && op.values && (op.values as any).status) {
							let tableIndex = this.activeIndex.get(op.table)
							if (!tableIndex) {
								tableIndex = new Map()
								this.activeIndex.set(op.table, tableIndex)
							}
							const key = `status:${(op.values as any).status}`
							let set = tableIndex.get(key)
							if (!set) {
								set = new Set()
								tableIndex.set(key, set)
							}
							set.add(op)
						}
					}
				}
				this.inFlightOps.clear()
				this.inFlightSize = 0
				this.inFlightIndex.clear()
			} finally {
				releaseStateFail()
			}
			if (isRetryable) throw e
		} finally {
			releaseFlush()
		}
	}

	private async executeBulkUpdate(trx: Transaction<Schema>, table: keyof Schema, group: WriteOp[]): Promise<number> {
		if (group.length === 0) return 0
		const first = group[0]
		if (!first?.values) return 0

		const canBatchIntoSingleStatement = group.every(
			(op) =>
				this.isSameValues(op.values as any, first.values as any) &&
				op.where &&
				!Array.isArray(op.where) &&
				op.where.column === "id" &&
				(op.where.operator === "=" || op.where.operator === undefined),
		)

		if (canBatchIntoSingleStatement && first.where && !Array.isArray(first.where)) {
			const ids: unknown[] = []
			for (const op of group) {
				const val = (op.where as WhereCondition).value
				if (Array.isArray(val)) {
					ids.push(...val)
				} else {
					ids.push(val)
				}
			}

			const valuesWithNoIncrements: Record<string, unknown> = {}
			const increments: Record<string, number> = {}
			for (const [k, v] of Object.entries(first.values)) {
				if (this.isIncrement(v)) {
					increments[k] = v.value
				} else {
					valuesWithNoIncrements[k] = v
				}
			}

			const query = trx.updateTable(table)
			const sets: Record<string, unknown> = { ...valuesWithNoIncrements }
			for (const [k, v] of Object.entries(increments)) {
				sets[k] = sql`${sql.ref(k)} + ${v}`
			}

			await query
				.set(sets as never)
				.where("id" as never, "in", ids as never)
				.execute()
			return group.length
		}

		const promises = group.map((op) => this.executeSingleOp(trx, op))
		await Promise.all(promises)
		return group.length
	}

	public async selectWhere<T extends keyof Schema>(
		table: T,
		where: WhereCondition | WhereCondition[],
		agentId?: string,
		options?: {
			orderBy?: { column: keyof Schema[T]; direction: "asc" | "desc" }
			limit?: number
		},
	): Promise<Schema[T][]> {
		const release = await this.stateMutex.acquire()
		try {
			const db = await this.ensureDb()
			const conditions = normalizeWhere(where)
			const statusCond = conditions.find(
				(c) => (c.column === "status" || c.column === "type") && (c.operator === "=" || !c.operator),
			)
			const indexKey = statusCond ? `${table as string}:${statusCond.column}:${statusCond.value}` : null
			const isWarmed = indexKey && this.warmedIndices.has(indexKey)

			let diskResults: Schema[T][] = []
			if (!isWarmed) {
				let query = db.selectFrom(table).selectAll()
				for (const cond of conditions) {
					const opStr = cond.operator || "="
					if (Array.isArray(cond.value)) {
						query = (query as any).where(cond.column, "in", cond.value)
					} else {
						query = (query as any).where(cond.column, opStr, cond.value)
					}
				}

				if (options?.orderBy) {
					query = (query as any).orderBy(options.orderBy.column, options.orderBy.direction)
				}
				if (options?.limit) {
					query = (query as any).limit(options.limit)
				}
				diskResults = (await query.execute()) as Schema[T][]
			}

			const applyOps = (ops: WriteOp[], sourceIndex: Map<string, Set<WriteOp>> | undefined, target: Schema[T][]) => {
				// Level 7: Fast-Path Status Indexing
				const statusCond = conditions.find(
					(c) => (c.column === "status" || c.column === "type") && (c.operator === "=" || !c.operator),
				)
				let tableOps: Iterable<WriteOp> = []

				if (statusCond && sourceIndex) {
					const key = `${statusCond.column}:${statusCond.value}`
					const set = sourceIndex.get(key)
					tableOps = set || []
				} else {
					tableOps = ops
				}

				for (const op of tableOps) {
					// Additional safety check if we're using a full buffer instead of an index
					if (op.table !== table) continue

					const applyValues = (existing: unknown, newValues: Record<string, unknown>, hasIncs?: boolean) => {
						const next = { ...(existing as Record<string, unknown>) }
						for (const [k, v] of Object.entries(newValues)) {
							if (hasIncs && this.isIncrement(v)) {
								next[k] = (Number(next[k]) || 0) + v.value
							} else {
								next[k] = v
							}
						}
						return next as Schema[T]
					}

					const opWhere = normalizeWhere(op.where)

					// Pre-compute Sets for IN operators to O(1) lookup
					const inSets = opWhere.map((c) => {
						if (c.operator?.toUpperCase() === "IN" && Array.isArray(c.value)) {
							return new Set(c.value as unknown[])
						}
						return null
					})

					const matches = (r: unknown, queryConditions: WhereCondition[]) => {
						const row = r as Record<string, unknown>
						if (queryConditions.length === 0) return true
						return queryConditions.every((c, idx) => {
							const val = row[c.column]
							const opStr = (c.operator || "=").toUpperCase()

							if (opStr === "IN") {
								// If this is matching against the op's where, use the pre-computed set
								// If this is matching against the SELECT's where, just use the array
								if (queryConditions === opWhere) {
									const set = inSets[idx]
									if (set) return set.has(val as any)
								}
								if (Array.isArray(c.value)) return (c.value as unknown[]).includes(val)
								return val === c.value
							}
							if (opStr === "=") return val === c.value
							if (opStr === "!=") return val !== c.value
							if (opStr === ">") return Number(val) > Number(c.value)
							if (opStr === "<") return Number(val) < Number(c.value)
							if (opStr === ">=") return Number(val) >= Number(c.value)
							if (opStr === "<=") return val !== null && Number(val) <= Number(c.value)
							return false
						})
					}

					if (op.type === "insert" && op.values) {
						const newRow = { ...op.values } as unknown as Schema[T]
						if (matches(newRow, conditions)) target.push(newRow)
					} else if (op.type === "upsert" && op.values) {
						const pkMatch = (r: unknown) => {
							const row = r as Record<string, unknown>
							if (opWhere.length > 0) return matches(row, opWhere)
							return (
								row.id !== undefined &&
								(op.values as Record<string, unknown>).id !== undefined &&
								row.id === (op.values as Record<string, unknown>).id
							)
						}
						const existingIdx = target.findIndex(pkMatch)
						if (existingIdx >= 0) {
							const existing = target[existingIdx]
							if (existing) {
								const next = applyValues(existing, op.values as Record<string, unknown>, op.hasIncrements)
								if (matches(next, conditions)) {
									target[existingIdx] = next
								} else {
									target.splice(existingIdx, 1)
								}
							}
						} else {
							const newRow = { ...op.values } as unknown as Schema[T]
							if (matches(newRow, conditions)) target.push(newRow)
						}
					} else if (op.type === "update" && op.values) {
						for (let i = target.length - 1; i >= 0; i--) {
							const existing = target[i]
							if (existing && matches(existing, opWhere)) {
								const next = applyValues(existing, op.values as Record<string, unknown>, op.hasIncrements)
								if (matches(next, conditions)) {
									target[i] = next
								} else {
									target.splice(i, 1)
								}
							}
						}
					} else if (op.type === "delete") {
						for (let i = target.length - 1; i >= 0; i--) {
							const existing = target[i]
							if (existing && matches(existing, opWhere)) target.splice(i, 1)
						}
					}
				}
			}

			let finalResults = [...diskResults]
			applyOps(this.inFlightOps.get(table) || [], this.inFlightIndex.get(table), finalResults)
			applyOps(this.activeBuffer.get(table) || [], this.activeIndex.get(table), finalResults)
			if (agentId) {
				const shadow = this.agentShadows.get(agentId)
				if (shadow) applyOps(shadow.ops, undefined, finalResults)
			}

			if (options?.orderBy) {
				const col = options.orderBy.column as string
				const dir = options.orderBy.direction
				finalResults.sort((a, b) => {
					const valA = (a as Record<string, unknown>)[col]
					const valB = (b as Record<string, unknown>)[col]
					if (valA === undefined || valB === undefined || valA === null || valB === null) return 0
					if (valA < valB) return dir === "asc" ? -1 : 1
					if (valA > valB) return dir === "asc" ? 1 : -1
					return 0
				})
			}
			if (options?.limit) finalResults = finalResults.slice(0, options.limit)
			return finalResults
		} finally {
			release()
		}
	}

	public async selectOne<T extends keyof Schema>(
		table: T,
		where: WhereCondition | WhereCondition[],
		agentId?: string,
	): Promise<Schema[T] | null> {
		const results = await this.selectWhere(table, where, agentId)
		return results.length > 0 ? (results[results.length - 1] as Schema[T]) : null
	}

	public static increment(value: number): Increment {
		return { _type: "increment", value }
	}

	private groupOps(ops: WriteOp[]): WriteOp[][] {
		const coalescedOps: WriteOp[] = []
		const updateCache = new Map<string, number>()

		for (const op of ops) {
			if (op.type === "update" && op.dedupKey) {
				const existingIdx = updateCache.get(op.dedupKey)
				if (existingIdx !== undefined) {
					const targetOp = coalescedOps[existingIdx]
					if (targetOp?.values && op.values) {
						for (const [key, val] of Object.entries(op.values)) {
							const existingVal: any = targetOp.values[key]
							const isInc = (v: any) => v && typeof v === "object" && (v as any)._type === "increment"

							if (isInc(val)) {
								if (isInc(existingVal)) {
									existingVal.value += (val as any).value
								} else if (typeof existingVal === "number") {
									targetOp.values[key] = existingVal + (val as any).value
								} else {
									targetOp.values[key] = { ...(val as any) } // Clone increment
								}
							} else {
								targetOp.values[key] = val // Raw value overrides previous state
							}
						}
						// Recalculate hasIncrements
						targetOp.hasIncrements = Object.values(targetOp.values).some(
							(v: any) => v && typeof v === "object" && v._type === "increment",
						)
						continue
					}
				} else {
					updateCache.set(op.dedupKey, coalescedOps.length)
				}
			}
			coalescedOps.push(op)
		}

		const groups: WriteOp[][] = []
		let currentGroup: WriteOp[] = []
		for (const op of coalescedOps) {
			if (op.type === "insert" && op.values) {
				if (currentGroup.length > 0 && currentGroup[0]?.table === op.table && currentGroup[0]?.type === "insert") {
					currentGroup.push(op)
				} else {
					if (currentGroup.length > 0) groups.push(currentGroup)
					currentGroup = [op]
				}
			} else {
				if (currentGroup.length > 0) groups.push(currentGroup)
				currentGroup = []
				groups.push([op])
			}
		}
		if (currentGroup.length > 0) groups.push(currentGroup)
		return groups
	}

	private async executeChunkedRawInsert(table: keyof Schema, group: WriteOp[]): Promise<number> {
		if (group.length === 0 || !this.rawDb) return 0
		const firstOp = group[0]
		if (!firstOp?.values) return 0

		const columns = Object.keys(firstOp.values)
		const CHUNK_SIZE = 100 // Optimal for SQLite param limits and SQL length

		let totalFlushed = 0
		for (let i = 0; i < group.length; i += CHUNK_SIZE) {
			const chunk = group.slice(i, i + CHUNK_SIZE)
			const valuePlaceholders = `(${columns.map(() => "?").join(",")})`
			const placeholders = chunk.map(() => valuePlaceholders).join(",")
			const sqlStr = `INSERT INTO ${table as string} (${columns.join(",")}) VALUES ${placeholders}`

			const stmt = this.getStatement(sqlStr)

			// Level 4 Optimization: Zero-Allocation Parameter Flattening
			// Reuse the pre-allocated parameterBuffer to avoid GC pressure for 1M+ ops
			let pIdx = 0
			for (const op of chunk) {
				const vals = op.values as Record<string, any>
				for (const col of columns) {
					this.parameterBuffer[pIdx++] = vals[col]
				}
			}

			const params = this.parameterBuffer.slice(0, pIdx)
			stmt.run(...params)
			totalFlushed += chunk.length
		}

		return totalFlushed
	}

	private async executeBulkInsert(trx: Transaction<Schema>, table: keyof Schema, group: WriteOp[]): Promise<number> {
		const firstOp = group[0]
		if (!firstOp?.values) return 0
		const columnCount = Object.keys(firstOp.values).length || 1
		const CHUNK_SIZE = Math.max(1, Math.floor(5000 / columnCount))
		let flushed = 0
		for (let i = 0; i < group.length; i += CHUNK_SIZE) {
			const chunk = group.slice(i, i + CHUNK_SIZE)
			const values = chunk.map((op) => op.values).filter((v): v is Record<string, unknown> => v !== undefined)
			await trx
				.insertInto(table)
				.values(values as never)
				.execute()
			flushed += chunk.length
		}
		return flushed
	}

	private isIncrement(value: unknown): value is Increment {
		return typeof value === "object" && value !== null && "_type" in value && (value as Increment)._type === "increment"
	}

	private detectMetadata(op: WriteOp) {
		op.hasIncrements = false
		if (op.values) {
			for (const v of Object.values(op.values)) {
				if (this.isIncrement(v)) {
					op.hasIncrements = true
					break
				}
			}
		}

		if (
			op.type === "update" &&
			op.where &&
			!Array.isArray(op.where) &&
			op.where.column === "id" &&
			(op.where.operator === "=" || op.where.operator === undefined)
		) {
			op.dedupKey = `${op.table as string}:${op.where.value}`
		}
	}

	private async executeSingleOp(trx: Transaction<Schema>, op: WriteOp) {
		const conditions = normalizeWhere(op.where)
		if (op.type === "insert" && op.values) {
			await trx
				.insertInto(op.table)
				.values(op.values as any)
				.execute()
		} else if (op.type === "upsert" && op.values) {
			let query = trx.insertInto(op.table).values(op.values as any)
			if (op.conflictTarget) {
				query = (query as any).onConflict((oc: any) =>
					oc.columns(Array.isArray(op.conflictTarget) ? op.conflictTarget : [op.conflictTarget]).doUpdateSet(op.values),
				)
			} else {
				query = (query as any).onConflict((oc: any) => oc.column("id").doUpdateSet(op.values))
			}
			await query.execute()
		} else if (op.type === "update" && op.values) {
			const sets: Record<string, any> = {}
			for (const [k, v] of Object.entries(op.values)) {
				if (this.isIncrement(v)) {
					sets[k] = sql`${sql.ref(k)} + ${v.value}`
				} else {
					sets[k] = v
				}
			}

			let query = trx.updateTable(op.table as any).set(sets)
			for (const cond of conditions) {
				const opStr = cond.operator || "="
				if (Array.isArray(cond.value)) {
					query = (query as any).where(cond.column, "in", cond.value)
				} else {
					query = (query as any).where(cond.column, opStr, cond.value)
				}
			}
			await query.execute()
		} else if (op.type === "delete") {
			let query = trx.deleteFrom(op.table)
			for (const cond of conditions) {
				const opStr = cond.operator || "="
				if (Array.isArray(cond.value)) {
					query = (query as any).where(cond.column, "in", cond.value)
				} else {
					query = (query as any).where(cond.column, opStr, cond.value)
				}
			}
			await query.execute()
		}
	}

	public getMetrics() {
		return {
			activeBuffer: this.activeBuffer === this.bufferA ? "A" : "B",
			activeBufferSize: this.activeBufferSize,
			inFlightOpsSize: this.inFlightSize,
			activeShadows: this.agentShadows.size,
			totalTransactions: this.totalTransactions,
			latencies: {
				enqueue: {
					p95: this.calculatePercentile(this.enqueueLatencies, 95),
					p99: this.calculatePercentile(this.enqueueLatencies, 99),
				},
				processing: {
					p95: this.calculatePercentile(this.processingLatencies, 95),
					p99: this.calculatePercentile(this.processingLatencies, 99),
				},
			},
		}
	}

	private isSameValues(a: Record<string, any>, b: Record<string, any>): boolean {
		if (a === b) return true
		const keysA = Object.keys(a)
		const keysB = Object.keys(b)
		if (keysA.length !== keysB.length) return false
		for (const key of keysA) {
			if (a[key] !== b[key]) {
				// Handle Increment objects specifically
				const valA = a[key]
				const valB = b[key]
				if (this.isIncrement(valA) && this.isIncrement(valB)) {
					if (valA.value !== valB.value) return false
				} else {
					return false
				}
			}
		}
		return true
	}

	/**
	 * Level 9: Sovereign Recovery (Warmup)
	 * Populates the in-memory Level 7 indexes from the Level 2 Checkpoint (Disk).
	 * This ensures the "Brain" wakes up at full speed after a reboot.
	 */
	public async warmupTable<T extends keyof Schema>(table: T, statusCol: string, statusValue: string): Promise<number> {
		const db = await this.ensureDb()
		const rows = await db
			.selectFrom(table as any)
			.where(statusCol as any, "=", statusValue as any)
			.selectAll()
			.execute()

		if (rows.length === 0) return 0

		let tableIndex = this.activeIndex.get(table as any)
		if (!tableIndex) {
			tableIndex = new Map()
			this.activeIndex.set(table as any, tableIndex)
		}

		const key = `${statusCol}:${statusValue}`
		let set = tableIndex.get(key)
		if (!set) {
			set = new Set()
			tableIndex.set(key, set)
		}

		// Convert disk rows into a "Virtual WriteOp" to satisfy Level 1 Select logic
		for (const row of rows) {
			const op: WriteOp = {
				type: "insert",
				table: table as any,
				values: row as any,
				hasIncrements: false,
			}
			set.add(op)
		}

		// Level 9: Mark as Authoritative
		this.warmedIndices.add(`${table as string}:${statusCol}:${statusValue}`)

		return rows.length
	}

	public async getActiveAffectedFiles(): Promise<Map<string, string>> {
		const release = await this.stateMutex.acquire()
		try {
			const activeFiles = new Map<string, string>()
			for (const [agentId, shadow] of this.agentShadows.entries()) {
				for (const file of shadow.affectedFiles) {
					activeFiles.set(file, agentId)
				}
			}
			return activeFiles
		} finally {
			release()
		}
	}

	public async selectAllFrom<T extends keyof Schema>(table: T, agentId?: string): Promise<Schema[T][]> {
		return this.selectWhere(table, [], agentId)
	}

	public async stop() {
		if (this.flushInterval) clearInterval(this.flushInterval)
		if (this.cleanupInterval) clearInterval(this.cleanupInterval)
		await this.flush()
	}
}

export const dbPool = new BufferedDbPool()
