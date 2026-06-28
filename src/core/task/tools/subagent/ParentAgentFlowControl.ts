import type { SubagentRunResult } from "./SubagentRunner"

export const DEFAULT_SUBAGENT_CONCURRENCY = 3
export const DEFAULT_SUBAGENT_MAX_ATTEMPTS = 3
export const SUBAGENT_ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000
export const SUBAGENT_SWARM_TIMEOUT_MS = 20 * 60 * 1000
export const SUBAGENT_ABORT_GRACE_MS = 2_000
export const SUBAGENT_ABORT_POLL_INTERVAL_MS = 50
export const SUBAGENT_STATUS_MIN_INTERVAL_MS = 250
export const SUBAGENT_UI_IO_TIMEOUT_MS = 2_000
export const SUBAGENT_AUDIT_PREFLIGHT_TIMEOUT_MS = 10_000
/** Minimum slots reserved for non-mutating lanes when they are waiting (bulkhead / I/O authority). */
export const SUBAGENT_FAST_IO_RESERVED_SLOTS = 1
/** Cap concurrent lane lifecycles to pool capacity + one queued successor (bounded work queue). */
export const SUBAGENT_IN_FLIGHT_LANE_BUFFER = 1

export function computeMaxInFlightLanes(concurrency = DEFAULT_SUBAGENT_CONCURRENCY): number {
	return concurrency + SUBAGENT_IN_FLIGHT_LANE_BUFFER
}

/** Release governed locks between parent-layer retries so backoff does not hold lane ownership. */
export function shouldReleaseLaneClaimBetweenAttempts(lockRequired: boolean, willRetry: boolean): boolean {
	return lockRequired && willRetry
}

/** Progress snapshots are UI-only; durable artifacts are written at terminal staging/seal barriers. */
export function shouldPersistSwarmProgressArtifact(status: "running" | "completed" | "failed", partial: boolean): boolean {
	return !partial || status !== "running"
}

/** Event-driven scheduler wake (mirrors condition variables / Tokio Notify). */
export function createSwarmSchedulerWake(): { notify: () => void; wait: () => Promise<void> } {
	let wake: (() => void) | undefined
	return {
		notify: () => {
			wake?.()
			wake = undefined
		},
		wait: () =>
			new Promise((resolve) => {
				wake = resolve
			}),
	}
}

export type SubagentRunStats = SubagentRunResult["stats"]

const TRANSIENT_FAILURE_PATTERNS = [
	/\b429\b/i,
	/\b5\d\d\b/i,
	/ECONNRESET/i,
	/ECONNREFUSED/i,
	/ETIMEDOUT/i,
	/EAI_AGAIN/i,
	/ENETUNREACH/i,
	/rate[ -]?limit/i,
	/throttl/i,
	/timed? out/i,
	/timeout/i,
	/temporar(?:y|ily) unavailable/i,
	/service unavailable/i,
	/socket hang up/i,
	/overloaded/i,
]

const TERMINAL_FAILURE_PATTERNS = [
	/authentication/i,
	/api key/i,
	/permission denied/i,
	/forbidden/i,
	/insufficient (?:balance|credit)/i,
	/iteration limit exceeded/i,
	/token budget exceeded/i,
	/cost budget exceeded/i,
	/tool call limit exceeded/i,
	/recursion limit/i,
	/cancel(?:led|ed)/i,
	/abort(?:ed)?/i,
]

export function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}
	return typeof error === "string" ? error : "Subagent execution failed"
}

/** Retry only failures that are likely to change without changing the task input. */
export function isRetryableSubagentFailure(error: unknown): boolean {
	const message = errorMessage(error)
	if (TERMINAL_FAILURE_PATTERNS.some((pattern) => pattern.test(message))) {
		return false
	}
	return TRANSIENT_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
}

/** AWS-style full jitter: a random delay between zero and a capped exponential ceiling. */
export function calculateRetryDelayMs(
	failedAttempts: number,
	random: () => number = Math.random,
	baseDelayMs = 500,
	maxDelayMs = 5_000,
): number {
	const exponent = Math.max(0, failedAttempts - 1)
	const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent)
	const normalizedRandom = Math.min(1, Math.max(0, random()))
	return Math.floor(normalizedRandom * ceiling)
}

export function emptySubagentRunStats(): SubagentRunStats {
	return {
		toolCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		contextTokens: 0,
		contextWindow: 0,
		contextUsagePercentage: 0,
	}
}

/** Preserve all billable retry usage while retaining peak context pressure. */
export function addSubagentRunStats(left: SubagentRunStats, right: SubagentRunStats): SubagentRunStats {
	return {
		toolCalls: left.toolCalls + right.toolCalls,
		inputTokens: left.inputTokens + right.inputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		totalCost: left.totalCost + right.totalCost,
		contextTokens: Math.max(left.contextTokens, right.contextTokens),
		contextWindow: Math.max(left.contextWindow, right.contextWindow),
		contextUsagePercentage: Math.max(left.contextUsagePercentage, right.contextUsagePercentage),
		maxTokens: right.maxTokens ?? left.maxTokens,
		maxCost: right.maxCost ?? left.maxCost,
	}
}

export async function waitForSettlement(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs)
			}),
		])
	} finally {
		if (timer) {
			clearTimeout(timer)
		}
	}
}

/**
 * Immediate + polled parent-abort watcher. Checks synchronously on registration and at a
 * bounded interval so cancellation does not wait for the next scheduler tick.
 */
export function createParentAbortWatcher(isAborted: () => boolean, onAbort: () => void): () => void {
	if (isAborted()) {
		onAbort()
		return () => undefined
	}

	const interval = setInterval(() => {
		if (!isAborted()) {
			return
		}
		clearInterval(interval)
		onAbort()
	}, SUBAGENT_ABORT_POLL_INTERVAL_MS)

	return () => clearInterval(interval)
}

/** FIFO concurrency pool. Waiting/backoff work consumes no active execution capacity. */
export class FairSemaphore {
	private active = 0
	private readonly waiters: Array<(release: () => void) => void> = []

	constructor(private readonly capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error(`Semaphore capacity must be a positive integer (received ${capacity}).`)
		}
	}

	acquire(): Promise<() => void> {
		if (this.active < this.capacity) {
			this.active++
			return Promise.resolve(this.createRelease())
		}
		return new Promise((resolve) => this.waiters.push(resolve))
	}

	getActiveCount(): number {
		return this.active
	}

	getPendingCount(): number {
		return this.waiters.length
	}

	private createRelease(): () => void {
		let released = false
		return () => {
			if (released) {
				return
			}
			released = true
			this.dispatchNext()
		}
	}

	private dispatchNext(): void {
		const next = this.waiters.shift()
		if (next) {
			next(this.createRelease())
			return
		}
		this.active--
	}
}

/**
 * Work-conserving pool with priority-aware slot handoff. Higher-priority waiters are
 * served first; equal priority preserves FIFO order (mirrors fork/join task queues).
 */
export class PriorityFairSemaphore {
	private active = 0
	private readonly waiters: Array<{ priority: number; sequence: number; resolve: (release: () => void) => void }> = []
	private sequence = 0

	constructor(private readonly capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error(`Semaphore capacity must be a positive integer (received ${capacity}).`)
		}
	}

	acquire(priority = 0): Promise<() => void> {
		const sequence = this.sequence++
		return new Promise((resolve) => {
			this.waiters.push({ priority, sequence, resolve })
			this.dispatchWhileCapacity()
		})
	}

	getActiveCount(): number {
		return this.active
	}

	getPendingCount(): number {
		return this.waiters.length
	}

	private createRelease(): () => void {
		let released = false
		return () => {
			if (released) {
				return
			}
			released = true
			this.active--
			this.dispatchWhileCapacity()
		}
	}

	private dispatchWhileCapacity(): void {
		while (this.active < this.capacity && this.waiters.length > 0) {
			const bestIndex = this.findBestWaiterIndex()
			const [next] = this.waiters.splice(bestIndex, 1)
			this.active++
			next.resolve(this.createRelease())
		}
	}

	private findBestWaiterIndex(): number {
		let bestIndex = 0
		for (let index = 1; index < this.waiters.length; index++) {
			const candidate = this.waiters[index]
			const best = this.waiters[bestIndex]
			if (
				candidate.priority > best.priority ||
				(candidate.priority === best.priority && candidate.sequence < best.sequence)
			) {
				bestIndex = index
			}
		}
		return bestIndex
	}
}

type AuthorityPoolWaiter = {
	priority: number
	sequence: number
	isFastIo: boolean
	resolve: (release: () => void) => void
}

/**
 * Bulkhead pool aligned with I/O execution authority: non-mutating lanes cannot be starved
 * by mutation lanes when slots are scarce (mirrors resilience4j bulkhead + fork/join fairness).
 */
export class AuthorityAwareExecutionPool {
	private active = 0
	private activeFastIo = 0
	private readonly waiters: AuthorityPoolWaiter[] = []
	private sequence = 0

	constructor(
		private readonly capacity: number,
		private readonly fastIoReservedSlots: number = SUBAGENT_FAST_IO_RESERVED_SLOTS,
	) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error(`Pool capacity must be a positive integer (received ${capacity}).`)
		}
		if (!Number.isInteger(fastIoReservedSlots) || fastIoReservedSlots < 0 || fastIoReservedSlots >= capacity) {
			throw new Error(
				`Fast I/O reserved slots must be an integer in [0, capacity) (received ${fastIoReservedSlots}, capacity ${capacity}).`,
			)
		}
	}

	acquire(priority: number, isFastIo: boolean): Promise<() => void> {
		const sequence = this.sequence++
		return new Promise((resolve) => {
			this.waiters.push({ priority, sequence, isFastIo, resolve })
			this.dispatchWhileCapacity()
		})
	}

	getActiveCount(): number {
		return this.active
	}

	getPendingCount(): number {
		return this.waiters.length
	}

	getActiveFastIoCount(): number {
		return this.activeFastIo
	}

	private activeMutationCount(): number {
		return this.active - this.activeFastIo
	}

	private fastIoWaitersPending(): boolean {
		return this.waiters.some((waiter) => waiter.isFastIo)
	}

	private canDispatch(waiter: AuthorityPoolWaiter): boolean {
		if (this.active >= this.capacity) {
			return false
		}
		if (waiter.isFastIo || !this.fastIoWaitersPending()) {
			return true
		}
		const maxMutationActive = this.capacity - this.fastIoReservedSlots
		return this.activeMutationCount() < maxMutationActive
	}

	private findBestEligibleWaiterIndex(): number {
		let bestIndex = -1
		for (let index = 0; index < this.waiters.length; index++) {
			const waiter = this.waiters[index]
			if (!this.canDispatch(waiter)) {
				continue
			}
			if (bestIndex === -1) {
				bestIndex = index
				continue
			}
			const best = this.waiters[bestIndex]
			if (waiter.priority > best.priority || (waiter.priority === best.priority && waiter.sequence < best.sequence)) {
				bestIndex = index
			}
		}
		return bestIndex
	}

	private dispatchWhileCapacity(): void {
		while (this.active < this.capacity) {
			const bestIndex = this.findBestEligibleWaiterIndex()
			if (bestIndex === -1) {
				break
			}
			const [next] = this.waiters.splice(bestIndex, 1)
			this.active++
			if (next.isFastIo) {
				this.activeFastIo++
			}
			next.resolve(this.createRelease(next.isFastIo))
		}
	}

	private createRelease(isFastIo: boolean): () => void {
		let released = false
		return () => {
			if (released) {
				return
			}
			released = true
			this.active--
			if (isFastIo) {
				this.activeFastIo--
			}
			this.dispatchWhileCapacity()
		}
	}
}

/**
 * Latest-value async emitter. Bursty progress is bounded to one expensive write per interval,
 * while flush() provides a barrier for initial, terminal, and test-visible states.
 */
export class CoalescingAsyncEmitter<T> {
	private pending?: T
	private timer?: ReturnType<typeof setTimeout>
	private draining?: Promise<void>
	private lastEmittedAt = 0
	private closed = false

	constructor(
		private readonly emit: (value: T) => Promise<void>,
		private readonly minIntervalMs: number,
		private readonly onError?: (error: unknown) => void,
	) {}

	enqueue(value: T): void {
		if (this.closed) {
			return
		}
		this.pending = value
		this.schedule()
	}

	async close(value: T): Promise<void> {
		this.closed = true
		await this.flush(value)
	}

	/** Stop accepting updates, discard any queued snapshot, and wait for the active emission to quiesce. */
	async stop(): Promise<void> {
		this.closed = true
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = undefined
		}
		this.pending = undefined
		if (this.draining) {
			await this.draining
		}
		this.pending = undefined
	}

	async flush(value?: T): Promise<void> {
		if (value !== undefined) {
			this.pending = value
		}
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = undefined
		}
		if (this.draining) {
			await this.draining
		}
		while (this.pending !== undefined) {
			const next = this.pending
			this.pending = undefined
			await this.emit(next)
			this.lastEmittedAt = Date.now()
		}
	}

	private schedule(): void {
		if (this.closed || this.timer || this.draining) {
			return
		}
		const delayMs = Math.max(0, this.minIntervalMs - (Date.now() - this.lastEmittedAt))
		this.timer = setTimeout(() => {
			this.timer = undefined
			this.draining = this.drain().finally(() => {
				this.draining = undefined
				if (this.pending !== undefined) {
					this.schedule()
				}
			})
		}, delayMs)
	}

	private async drain(): Promise<void> {
		if (this.pending === undefined) {
			return
		}
		const next = this.pending
		this.pending = undefined
		try {
			await this.emit(next)
			this.lastEmittedAt = Date.now()
		} catch (error) {
			this.onError?.(error)
		}
	}
}
