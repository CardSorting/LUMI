import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry } from "./grpc-handler"
import type { StreamingResponseHandler } from "./grpc-handler-types"

export interface FanoutResult {
	delivered: number
	pruned: number
	failed: number
}

const activeHubs = new Set<PersistentSubscriptionHub<unknown>>()

/** Clears all persistent subscription hubs (extension shutdown). */
export function disposeAllPersistentSubscriptionHubs(): void {
	for (const hub of activeHubs) {
		hub.dispose()
	}
	activeHubs.clear()
}

/**
 * Centralized server-side hub for persistent streaming subscriptions.
 * Provides ref-safe registration and isolated fanout with dead-subscriber pruning.
 */
export class PersistentSubscriptionHub<T> {
	private readonly subscriptions = new Set<StreamingResponseHandler<T>>()
	private readonly debugLabel: string

	constructor(debugLabel: string) {
		this.debugLabel = debugLabel
		activeHubs.add(this as PersistentSubscriptionHub<unknown>)
	}

	get size(): number {
		return this.subscriptions.size
	}

	register(responseStream: StreamingResponseHandler<T>, requestId: string | undefined, metadata?: unknown): void {
		this.subscriptions.add(responseStream)

		if (!requestId) {
			return
		}

		const cleanup = () => {
			this.subscriptions.delete(responseStream)
		}

		getRequestRegistry().registerRequest(requestId, cleanup, metadata, responseStream as StreamingResponseHandler)
	}

	async broadcast(message: T): Promise<FanoutResult> {
		const result: FanoutResult = { delivered: 0, pruned: 0, failed: 0 }

		for (const responseStream of Array.from(this.subscriptions)) {
			try {
				await responseStream(message, false)
				result.delivered += 1
			} catch (error) {
				result.failed += 1
				this.subscriptions.delete(responseStream)
				result.pruned += 1
				Logger.warn(`[PersistentSubscriptionHub:${this.debugLabel}] Pruned dead subscriber`, error)
			}
		}

		if (result.pruned > 0) {
			Logger.info(
				`[PersistentSubscriptionHub:${this.debugLabel}] Fanout delivered=${result.delivered} pruned=${result.pruned}`,
			)
		}

		return result
	}

	dispose(): void {
		this.subscriptions.clear()
		activeHubs.delete(this as PersistentSubscriptionHub<unknown>)
	}
}
