import { Logger } from "@/shared/services/Logger"

/**
 * ExecuteOptions defines the reliability parameters for a tool action.
 */
export interface ExecuteOptions {
	timeoutMs?: number
	maxRetries?: number
	backoffMs?: number
	concurrencyGroup?: string
}

/**
 * ActionExecutor manages the lifecycle of tool actions.
 * It provides concurrency limiting, retries, timeout protection, and a circuit breaker.
 */
export class ActionExecutor {
	private static activeOperations = new Map<string, number>()
	private static queues = new Map<string, (() => void)[]>()

	// Parameterized constants for production hardening
	private static CONFIG = {
		MAX_CONCURRENCY: 5,
		CIRCUIT_OPEN_THRESHOLD: 20,
		CIRCUIT_RESET_MS: 30000,
		DEFAULT_TIMEOUT: 60000, // 60 seconds
	}

	private static failuresInWindow = 0
	private static lastFailureTime = 0

	/**
	 * Execute an async task with retries and timeout protection.
	 */
	async execute<T>(taskId: string, operation: () => Promise<T>, options: ExecuteOptions = {}): Promise<T> {
		const {
			timeoutMs = ActionExecutor.CONFIG.DEFAULT_TIMEOUT,
			maxRetries = 3,
			backoffMs = 500,
			concurrencyGroup = "default",
		} = options

		let attempts = 0

		while (attempts < maxRetries) {
			if (this.isCircuitOpen()) {
				throw new Error(`[ActionExecutor] Circuit is OPEN. Task ${taskId} rejected to prevent cascading failure.`)
			}

			try {
				const result = await this.withConcurrency(concurrencyGroup, () =>
					this.withTimeout(taskId, operation(), timeoutMs),
				)
				this.onSuccess()
				return result
			} catch (err: any) {
				attempts++
				const isRetryable = this.isRetryableError(err)

				if (attempts >= maxRetries || !isRetryable) {
					this.onFailure()
					Logger.error(`[ActionExecutor] Task ${taskId} failed permanently after ${attempts} attempts:`, err)
					throw err
				}

				const delay = backoffMs * 2 ** (attempts - 1)
				Logger.warn(
					`[ActionExecutor] Task ${taskId} retrying (${attempts}/${maxRetries}) because of retryable error: ${
						err.message || err
					}. Backoff: ${delay}ms`,
				)
				await new Promise((r) => setTimeout(r, delay))
			}
		}
		throw new Error(`[ActionExecutor] Task ${taskId} failed after max retries`)
	}

	private async withConcurrency<T>(group: string, op: () => Promise<T>): Promise<T> {
		const active = ActionExecutor.activeOperations.get(group) || 0

		if (active >= ActionExecutor.CONFIG.MAX_CONCURRENCY) {
			// Wait for a slot in the queue
			await new Promise<void>((resolve) => {
				const queue = ActionExecutor.queues.get(group) || []
				queue.push(resolve)
				ActionExecutor.queues.set(group, queue)
			})
		}

		ActionExecutor.activeOperations.set(group, (ActionExecutor.activeOperations.get(group) || 0) + 1)

		try {
			return await op()
		} finally {
			const remaining = (ActionExecutor.activeOperations.get(group) || 1) - 1
			ActionExecutor.activeOperations.set(group, remaining)

			// Notify the next in queue if any
			const queue = ActionExecutor.queues.get(group)
			if (queue && queue.length > 0) {
				const next = queue.shift()!
				if (queue.length === 0) {
					ActionExecutor.queues.delete(group)
				}
				next()
			}
		}
	}

	private async withTimeout<T>(id: string, promise: Promise<T>, ms: number): Promise<T> {
		const timeout = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`[ActionExecutor] Task ${id} timed out after ${ms}ms`)), ms)
		})
		return Promise.race([promise, timeout])
	}

	private isRetryableError(err: any): boolean {
		const message = (err.message || String(err)).toUpperCase()
		return (
			message.includes("ABORTED") ||
			message.includes("CONTENTION") ||
			message.includes("DEADLINE EXCEEDED") ||
			message.includes("SQLITE_BUSY") ||
			message.includes("SQLITE_LOCKED") ||
			message.includes("TIMEOUT") ||
			message.includes("RATE_LIMIT") ||
			message.includes("UNAVAILABLE")
		)
	}

	private isCircuitOpen(): boolean {
		if (ActionExecutor.failuresInWindow >= ActionExecutor.CONFIG.CIRCUIT_OPEN_THRESHOLD) {
			if (Date.now() - ActionExecutor.lastFailureTime < ActionExecutor.CONFIG.CIRCUIT_RESET_MS) {
				return true
			}
			// Reset after window
			ActionExecutor.failuresInWindow = 0
		}
		return false
	}

	private onSuccess() {
		if (ActionExecutor.failuresInWindow > 0) {
			ActionExecutor.failuresInWindow = Math.max(0, ActionExecutor.failuresInWindow - 1)
		}
	}

	private onFailure() {
		ActionExecutor.failuresInWindow++
		ActionExecutor.lastFailureTime = Date.now()
	}
}

export const executor = new ActionExecutor()
