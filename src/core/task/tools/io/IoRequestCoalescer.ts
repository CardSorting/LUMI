import pathModule from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@/shared/tools"
import { isIoAuthorityTool } from "../execution/ExecutionFunnel"

export type IoCoalesceKey = string

export interface IoCoalesceAuthorityIdentity {
	canonicalAbsoluteTarget: string
	filesystemGeneration: number
	policyGeneration: number
	workspaceIdentity: string
}

/**
 * Build a collision-free semantic identity for cacheable task-local I/O.
 *
 * Approval is intentionally absent: external paths are never eligible and an
 * approval decision must never become reusable cache authority. Callers using
 * the legacy cwd form still receive a safe key for isolated tests.
 */
export function buildIoCoalesceKey(
	block: ToolUse,
	cwdOrAuthority: string | IoCoalesceAuthorityIdentity,
	generation = 0,
): IoCoalesceKey | null {
	if (!isIoAuthorityTool(block.name)) return null

	const rawPath = (block.params.path ?? block.params.absolutePath)?.trim()
	if (!rawPath) return null

	const semantic: unknown[] = []
	switch (block.name) {
		case DietCodeDefaultTool.FILE_READ: {
			// scratchpad.md has create-on-miss semantics and images add invocation-local
			// projection blocks, so neither payload is safe for whole-result reuse.
			const extension = pathModule.extname(rawPath).toLowerCase()
			if (pathModule.basename(rawPath).toLowerCase() === "scratchpad.md") return null
			if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return null
			break
		}
		case DietCodeDefaultTool.LIST_FILES:
			semantic.push(block.params.recursive?.trim().toLowerCase() === "true")
			break
		case DietCodeDefaultTool.SEARCH: {
			const regex = (block.params.regex ?? block.params.query)?.trim()
			if (!regex) return null
			semantic.push(regex, block.params.file_pattern?.trim() ?? "")
			break
		}
		case DietCodeDefaultTool.LIST_CODE_DEF:
			break
		default:
			// Diagnostics and future I/O tools may depend on state not represented here.
			return null
	}

	const authority =
		typeof cwdOrAuthority === "string"
			? {
					canonicalAbsoluteTarget: pathModule.resolve(cwdOrAuthority, rawPath),
					filesystemGeneration: generation,
					policyGeneration: 0,
					workspaceIdentity: pathModule.resolve(cwdOrAuthority),
				}
			: cwdOrAuthority

	return JSON.stringify([
		"io-v2",
		block.name,
		authority.canonicalAbsoluteTarget,
		authority.filesystemGeneration,
		authority.policyGeneration,
		authority.workspaceIdentity,
		...semantic,
	])
}

type InFlightEntry<T> = {
	promise: Promise<T>
	at: number
}

export interface IoCoalescerStats {
	inFlight: number
	cached: number
	generation: number
	cacheHits: number
	cacheMisses: number
	coalescedWaiters: number
	executions: number
	cancelledWaiters: number
}

export type IoCoalesceDisposition = "cache_hit" | "coalesced_waiter" | "leader"

function abortError(): Error {
	const error = new Error("I/O request aborted")
	error.name = "AbortError"
	return error
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
	if (!signal) return promise
	if (signal.aborted) {
		onAbort?.()
		return Promise.reject(signal.reason ?? abortError())
	}
	return new Promise<T>((resolve, reject) => {
		const aborted = () => {
			onAbort?.()
			reject(signal.reason ?? abortError())
		}
		signal.addEventListener("abort", aborted, { once: true })
		promise.then(
			(value) => {
				signal.removeEventListener("abort", aborted)
				resolve(value)
			},
			(error) => {
				signal.removeEventListener("abort", aborted)
				reject(error)
			},
		)
	})
}

/**
 * Task-generation singleflight plus a tiny immutable-result cache. Backend
 * cancellation remains task-owned; an individual coalesced waiter can detach
 * promptly without cancelling a leader still needed by other waiters.
 */
export class IoRequestCoalescer {
	private readonly inFlight = new Map<IoCoalesceKey, InFlightEntry<unknown>>()
	private readonly recent = new Map<IoCoalesceKey, { value: unknown; at: number }>()
	private cacheHits = 0
	private cacheMisses = 0
	private coalescedWaiters = 0
	private executions = 0
	private cancelledWaiters = 0
	private disposed = false

	constructor(
		private readonly recentTtlMs = 5_000,
		private readonly maxEntries = 128,
		readonly generation = 0,
		private readonly now: () => number = Date.now,
	) {}

	async coalesce<T>(
		key: IoCoalesceKey,
		execute: () => Promise<T>,
		signal?: AbortSignal,
		onDisposition?: (disposition: IoCoalesceDisposition) => void,
	): Promise<T> {
		if (this.disposed) throw new Error("I/O request coalescer is disposed")
		if (signal?.aborted) {
			this.cancelledWaiters++
			throw signal.reason ?? abortError()
		}

		const now = this.now()
		this.prune(now)
		const cached = this.recent.get(key)
		if (cached && now - cached.at < this.recentTtlMs) {
			this.cacheHits++
			onDisposition?.("cache_hit")
			return cached.value as T
		}

		this.cacheMisses++
		const existing = this.inFlight.get(key)
		if (existing) {
			this.coalescedWaiters++
			onDisposition?.("coalesced_waiter")
			return waitWithSignal(existing.promise as Promise<T>, signal, () => this.cancelledWaiters++)
		}

		this.executions++
		onDisposition?.("leader")
		// Normalize synchronous throws without adding an avoidable promise hop on
		// the normal async path.
		let execution: Promise<T>
		try {
			execution = execute()
		} catch (error) {
			execution = Promise.reject(error)
		}
		const promise = execution
			.then((value) => {
				if (!this.disposed) this.remember(key, value)
				return value
			})
			.finally(() => {
				this.inFlight.delete(key)
			})

		// A caller may detach on abort while the task-owned backend settles. Keep a
		// rejection handler attached so that settlement never becomes unhandled.
		void promise.catch(() => undefined)
		this.inFlight.set(key, { promise, at: now })
		return waitWithSignal(promise, signal, () => this.cancelledWaiters++)
	}

	getStats(): IoCoalescerStats {
		return {
			inFlight: this.inFlight.size,
			cached: this.recent.size,
			generation: this.generation,
			cacheHits: this.cacheHits,
			cacheMisses: this.cacheMisses,
			coalescedWaiters: this.coalescedWaiters,
			executions: this.executions,
			cancelledWaiters: this.cancelledWaiters,
		}
	}

	dispose(): void {
		this.disposed = true
		this.recent.clear()
		// In-flight work is owned by the task AbortSignal. Do not sever its map
		// entry early; finalizers delete it when the backend settles.
	}

	private remember(key: IoCoalesceKey, value: unknown): void {
		// Map insertion order gives O(1) bounded FIFO eviction; recent hits do not
		// need LRU churn for this short task-local TTL.
		this.recent.set(key, { value, at: this.now() })
		while (this.recent.size > this.maxEntries) {
			const oldest = this.recent.keys().next().value as string | undefined
			if (oldest === undefined) break
			this.recent.delete(oldest)
		}
	}

	private prune(now: number): void {
		for (const [key, entry] of this.recent) {
			if (now - entry.at <= this.recentTtlMs) continue
			this.recent.delete(key)
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
	const previous = coalescersByTask.get(taskId)
	const generation = (previous?.generation ?? 0) + 1
	previous?.coalescer.dispose()
	coalescersByTask.set(taskId, {
		generation,
		coalescer: new IoRequestCoalescer(5_000, 128, generation),
	})
}

export function disposeIoRequestCoalescer(taskId: string): void {
	const state = coalescersByTask.get(taskId)
	state?.coalescer.dispose()
	coalescersByTask.delete(taskId)
}

export function getIoRequestCoalescerGeneration(taskId: string): number {
	return coalescersByTask.get(taskId)?.generation ?? 0
}

export function getIoRequestCoalescerTaskCountForTests(): number {
	return coalescersByTask.size
}
