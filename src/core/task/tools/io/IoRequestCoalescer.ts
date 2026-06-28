import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@/shared/tools"
import { isIoAuthorityTool } from "../executionAuthority"

export type IoCoalesceKey = string

/** Build a stable dedupe key for parent/lane I/O authority tools. */
export function buildIoCoalesceKey(block: ToolUse, cwd: string): IoCoalesceKey | null {
	if (!isIoAuthorityTool(block.name)) {
		return null
	}
	const path = block.params.path?.trim()
	const query = block.params.query?.trim() || block.params.regex?.trim()
	const parts = [block.name, cwd, path ?? "", query ?? ""]
	if (block.name === DietCodeDefaultTool.LIST_FILES) {
		parts.push(block.params.recursive ?? "", block.params.path ?? ".")
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

	constructor(
		private readonly recentTtlMs = 5_000,
		private readonly maxEntries = 128,
	) {}

	async coalesce<T>(key: IoCoalesceKey, execute: () => Promise<T>): Promise<T> {
		const now = Date.now()
		this.prune(now)

		const cached = this.recent.get(key)
		if (cached && now - cached.at < this.recentTtlMs) {
			return cached.value as T
		}

		const existing = this.inFlight.get(key)
		if (existing) {
			return existing.promise as Promise<T>
		}

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

	getStats(): { inFlight: number; cached: number } {
		return { inFlight: this.inFlight.size, cached: this.recent.size }
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

const coalescersByTask = new Map<string, IoRequestCoalescer>()

export function getIoRequestCoalescer(taskId: string): IoRequestCoalescer {
	let coalescer = coalescersByTask.get(taskId)
	if (!coalescer) {
		coalescer = new IoRequestCoalescer()
		coalescersByTask.set(taskId, coalescer)
	}
	return coalescer
}

export function resetIoRequestCoalescer(taskId: string): void {
	coalescersByTask.delete(taskId)
}
