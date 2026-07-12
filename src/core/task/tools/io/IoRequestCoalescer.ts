import pathModule from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@/shared/tools"
import { isIoAuthorityTool } from "../executionAuthority"

export type IoCoalesceKey = string

/** Build a stable dedupe key for parent/lane I/O authority tools. */
export function buildIoCoalesceKey(block: ToolUse, cwd: string, generation = 0): IoCoalesceKey | null {
	if (!isIoAuthorityTool(block.name)) {
		return null
	}
	const rawPath = block.params.path?.trim()
	const target = pathModule.resolve(cwd, rawPath || ".")
	const query = block.params.query?.trim() || block.params.regex?.trim()
	const parts = [`generation:${generation}`, block.name, target, query ?? "", block.params.file_pattern?.trim() ?? ""]
	if (block.name === DietCodeDefaultTool.LIST_FILES) {
		parts.push(block.params.recursive ?? "")
	}
	return parts.join("|")
}

type InFlightEntry<T> = {
	promise: Promise<T>
	at: number
}

/**
 * Coalesces identical in-flight I/O requests (mirrors HTTP singleflight / DB read coalescing).
 * Completed entries expire after TTL to allow fresh reads after mutations.
 */
export class IoRequestCoalescer {
	private readonly inFlight = new Map<IoCoalesceKey, InFlightEntry<unknown>>()
	private readonly recent = new Map<IoCoalesceKey, { value: unknown; at: number }>()
	private cacheHits = 0
	private coalescedWaiters = 0
	private executions = 0

	constructor(
		private readonly recentTtlMs = 5_000,
		private readonly maxEntries = 128,
		readonly generation = 0,
	) {}

	async coalesce<T>(key: IoCoalesceKey, execute: () => Promise<T>): Promise<T> {
		const now = Date.now()
		this.prune(now)

		const cached = this.recent.get(key)
		if (cached && now - cached.at < this.recentTtlMs) {
			this.cacheHits++
			return cached.value as T
		}

		const existing = this.inFlight.get(key)
		if (existing) {
			this.coalescedWaiters++
			return existing.promise as Promise<T>
		}

		this.executions++
		const promise = execute()
			.then((value) => {
				this.recent.set(key, { value, at: Date.now() })
				return value
			})
			.finally(() => {
				this.inFlight.delete(key)
			})

		this.inFlight.set(key, { promise, at: now })
		return promise
	}

	getStats(): {
		inFlight: number
		cached: number
		generation: number
		cacheHits: number
		coalescedWaiters: number
		executions: number
	} {
		return {
			inFlight: this.inFlight.size,
			cached: this.recent.size,
			generation: this.generation,
			cacheHits: this.cacheHits,
			coalescedWaiters: this.coalescedWaiters,
			executions: this.executions,
		}
	}

	private prune(now: number): void {
		for (const [key, entry] of this.recent) {
			if (now - entry.at > this.recentTtlMs) {
				this.recent.delete(key)
			}
		}
		if (this.recent.size > this.maxEntries) {
			const sorted = [...this.recent.entries()].sort((a, b) => a[1].at - b[1].at)
			for (const [key] of sorted.slice(0, this.recent.size - this.maxEntries)) {
				this.recent.delete(key)
			}
		}
	}
}

const coalescersByTask = new Map<string, { generation: number; coalescer: IoRequestCoalescer }>()

export function getIoRequestCoalescer(taskId: string): IoRequestCoalescer {
	let state = coalescersByTask.get(taskId)
	if (!state) {
		state = { generation: 0, coalescer: new IoRequestCoalescer(5_000, 128, 0) }
		coalescersByTask.set(taskId, state)
	}
	return state.coalescer
}

export function resetIoRequestCoalescer(taskId: string): void {
	const generation = (coalescersByTask.get(taskId)?.generation ?? 0) + 1
	coalescersByTask.set(taskId, {
		generation,
		coalescer: new IoRequestCoalescer(5_000, 128, generation),
	})
}

export function getIoRequestCoalescerGeneration(taskId: string): number {
	return coalescersByTask.get(taskId)?.generation ?? 0
}
