import {
	computeBackoffDelay,
	DEFAULT_RECONNECT_POLICY,
	DEFAULT_STALE_AFTER_MS,
	isDegradedState,
	isHealthyState,
	isReconnectEligible,
	isTerminalFailedState,
	mergeReconnectPolicy,
	type ReconnectPolicy,
	type ReconnectReason,
	type SubscriptionHealthState,
	shouldRecoverFromFailedOnAcquire,
} from "@shared/grpc/persistent-stream"
import type { Callbacks } from "./grpc-client-base"

export type { ReconnectPolicy, ReconnectReason, SubscriptionHealthState }

type SubscribeFn<TRequest, TResponse> = (request: TRequest, callbacks: Callbacks<TResponse>) => () => void

export interface GrpcSubscriptionDefinition<TRequest, TResponse> {
	key: string
	debugLabel?: string
	subscribe: SubscribeFn<TRequest, TResponse>
	request: TRequest
	autoReconnect?: boolean
	reconnect?: Partial<ReconnectPolicy>
	/** When set, reconnect if no events arrive within this window. Omit for event-only streams. */
	staleAfterMs?: number | null
}

export interface GrpcSubscriptionConsumerOptions<TResponse> {
	onMessage: (response: TResponse) => void
	onError?: (error: Error) => void
	onHealthChange?: (state: SubscriptionHealthState) => void
}

export interface GrpcSubscriptionSnapshot {
	key: string
	debugLabel: string
	state: SubscriptionHealthState
	refCount: number
	reconnectAttempt: number
	lastEventAt: number | null
	lastError: string | null
	lastReconnectReason: ReconnectReason | null
	hasActiveTransport: boolean
}

interface Consumer<TResponse> {
	id: symbol
	handlers: GrpcSubscriptionConsumerOptions<TResponse>
}

interface StreamEntry<TRequest = unknown, TResponse = unknown> {
	definition: GrpcSubscriptionDefinition<TRequest, TResponse>
	consumers: Map<symbol, Consumer<TResponse>>
	cancel: (() => void) | null
	state: SubscriptionHealthState
	reconnectAttempt: number
	reconnectTimer: ReturnType<typeof setTimeout> | undefined
	staleTimer: ReturnType<typeof setTimeout> | undefined
	lastEventAt: number | null
	lastError: string | null
	lastReconnectReason: ReconnectReason | null
	connecting: boolean
	generation: number
}

type HealthListener = (snapshots: ReadonlyMap<string, GrpcSubscriptionSnapshot>) => void

const QUIET_ERROR_PREFIX = "[GrpcSubscriptionRuntime]"

function logDebug(message: string): void {
	if (import.meta.env.DEV) {
		console.debug(message)
	}
}

function logRecovery(key: string, reason: ReconnectReason, attempt: number): void {
	logDebug(`${QUIET_ERROR_PREFIX} Recovering "${key}" (${reason}, attempt ${attempt})`)
}

/**
 * Production-grade client runtime for persistent gRPC subscriptions.
 * Invariants: one transport per key, ref-counted consumers, idempotent teardown, race-safe timers.
 */
export class GrpcSubscriptionRuntime {
	private streams = new Map<string, StreamEntry>()
	private healthListeners = new Set<HealthListener>()
	private lifecycleListenersAttached = false

	acquire<TRequest, TResponse>(
		definition: GrpcSubscriptionDefinition<TRequest, TResponse>,
		consumer: GrpcSubscriptionConsumerOptions<TResponse>,
	): () => void {
		const consumerId = Symbol(definition.key)
		let entry = this.streams.get(definition.key) as StreamEntry<TRequest, TResponse> | undefined

		if (!entry) {
			entry = this.createEntry(definition)
			this.streams.set(definition.key, entry as StreamEntry)
			this.ensureLifecycleListeners()
		} else {
			entry.definition = definition
		}

		entry.consumers.set(consumerId, { id: consumerId, handlers: consumer as GrpcSubscriptionConsumerOptions<TResponse> })
		consumer.onHealthChange?.(entry.state)

		if (shouldRecoverFromFailedOnAcquire(entry.state)) {
			entry.reconnectAttempt = 0
			entry.lastError = null
		}

		this.ensureTransport(entry as StreamEntry)

		return () => {
			this.release(definition.key, consumerId)
		}
	}

	getSnapshot(key: string): GrpcSubscriptionSnapshot | undefined {
		const entry = this.streams.get(key)
		if (!entry) {
			return undefined
		}
		return this.toSnapshot(entry)
	}

	getSnapshots(): ReadonlyMap<string, GrpcSubscriptionSnapshot> {
		return new Map(Array.from(this.streams.entries()).map(([key, entry]) => [key, this.toSnapshot(entry)]))
	}

	getHealthState(key: string): SubscriptionHealthState {
		return this.streams.get(key)?.state ?? "idle"
	}

	onHealthChange(listener: HealthListener): () => void {
		this.healthListeners.add(listener)
		listener(this.getSnapshots())
		return () => {
			this.healthListeners.delete(listener)
		}
	}

	reconnectAll(reason: ReconnectReason = "manual"): void {
		for (const entry of this.streams.values()) {
			if (!this.isLive(entry) || entry.consumers.size === 0) {
				continue
			}
			this.reconnectTransport(entry, reason, { resetAttempt: true })
		}
	}

	reconnectStale(reason: ReconnectReason = "visibility_restore"): void {
		for (const entry of this.streams.values()) {
			if (!this.isLive(entry) || entry.consumers.size === 0) {
				continue
			}
			if (entry.connecting) {
				continue
			}
			if (isHealthyState(entry.state) && entry.cancel != null) {
				continue
			}
			if (!isReconnectEligible(entry.state) || isTerminalFailedState(entry.state)) {
				continue
			}
			this.reconnectTransport(entry, reason, { resetAttempt: true })
		}
	}

	/** Test-only reset */
	resetForTests(): void {
		for (const entry of Array.from(this.streams.values())) {
			this.disposeEntry(entry, { sendCancel: true })
		}
		this.streams.clear()
	}

	private createEntry<TRequest, TResponse>(
		definition: GrpcSubscriptionDefinition<TRequest, TResponse>,
	): StreamEntry<TRequest, TResponse> {
		return {
			definition,
			consumers: new Map(),
			cancel: null,
			state: "idle",
			reconnectAttempt: 0,
			reconnectTimer: undefined,
			staleTimer: undefined,
			lastEventAt: null,
			lastError: null,
			lastReconnectReason: null,
			connecting: false,
			generation: 0,
		}
	}

	private release(key: string, consumerId: symbol): void {
		const entry = this.streams.get(key)
		if (!entry || !entry.consumers.has(consumerId)) {
			return
		}

		entry.consumers.delete(consumerId)
		if (entry.consumers.size > 0) {
			return
		}

		this.disposeEntry(entry, { sendCancel: true })
		this.streams.delete(key)
		this.notifyHealthChange()
	}

	private disposeEntry(entry: StreamEntry, options: { sendCancel: boolean }): void {
		entry.generation += 1
		this.clearReconnectTimer(entry)
		this.clearStaleTimer(entry)
		this.teardownTransport(entry, options)
	}

	private ensureTransport(entry: StreamEntry): void {
		if (!this.isLive(entry) || entry.consumers.size === 0) {
			return
		}
		if (entry.connecting || entry.cancel != null) {
			return
		}
		this.connectTransport(entry, "handler_replacement")
	}

	private isLive(entry: StreamEntry): boolean {
		return this.streams.get(entry.definition.key) === entry
	}

	private connectTransport(entry: StreamEntry, reason: ReconnectReason): void {
		if (!this.isLive(entry) || entry.connecting || entry.consumers.size === 0) {
			return
		}

		const generation = entry.generation
		this.clearReconnectTimer(entry)
		this.teardownTransport(entry, { sendCancel: true })

		if (!this.isLive(entry) || entry.generation !== generation || entry.consumers.size === 0) {
			return
		}

		const { definition } = entry
		entry.connecting = true
		this.setState(entry, entry.reconnectAttempt > 0 ? "reconnecting" : "connecting")
		entry.lastReconnectReason = reason

		logDebug(`${QUIET_ERROR_PREFIX} Connecting "${definition.key}" (${reason})`)

		entry.cancel = definition.subscribe(definition.request, {
			onResponse: (response) => {
				if (!this.isLive(entry) || entry.generation !== generation) {
					return
				}
				entry.connecting = false
				entry.reconnectAttempt = 0
				entry.lastEventAt = Date.now()
				entry.lastError = null
				this.setState(entry, "connected")
				this.resetStaleTimer(entry, generation)
				this.dispatchMessage(entry, response)
			},
			onError: (error) => {
				if (!this.isLive(entry) || entry.generation !== generation) {
					return
				}
				entry.connecting = false
				entry.lastError = error.message
				this.handleTransportEnd(entry, generation, "stream_error", error)
			},
			onComplete: () => {
				if (!this.isLive(entry) || entry.generation !== generation) {
					return
				}
				entry.connecting = false
				this.handleTransportEnd(entry, generation, "stream_complete")
			},
		})
	}

	private handleTransportEnd(entry: StreamEntry, generation: number, reason: ReconnectReason, error?: Error): void {
		if (!this.isLive(entry) || entry.generation !== generation) {
			return
		}

		this.teardownTransport(entry, { sendCancel: false })
		this.setState(entry, entry.reconnectAttempt > 0 ? "degraded" : "disconnected")

		for (const consumer of entry.consumers.values()) {
			if (error) {
				try {
					consumer.handlers.onError?.(error)
				} catch (callbackError) {
					console.error(`${QUIET_ERROR_PREFIX} onError callback failed:`, callbackError)
				}
			}
		}

		const autoReconnect = entry.definition.autoReconnect ?? true
		if (!autoReconnect || entry.consumers.size === 0) {
			return
		}

		this.scheduleReconnect(entry, generation, reason)
	}

	private scheduleReconnect(entry: StreamEntry, generation: number, reason: ReconnectReason): void {
		if (!this.isLive(entry) || entry.generation !== generation || entry.reconnectTimer || entry.consumers.size === 0) {
			return
		}

		const policy = mergeReconnectPolicy(entry.definition.reconnect)
		if (entry.reconnectAttempt >= policy.maxAttempts) {
			this.setState(entry, "failed")
			entry.lastError = `Exceeded max reconnect attempts (${policy.maxAttempts})`
			logDebug(`${QUIET_ERROR_PREFIX} "${entry.definition.key}" entered failed state`)
			return
		}

		const delay = computeBackoffDelay(entry.reconnectAttempt, policy)
		entry.reconnectAttempt += 1
		this.setState(entry, "reconnecting")
		logRecovery(entry.definition.key, reason, entry.reconnectAttempt)

		entry.reconnectTimer = setTimeout(() => {
			entry.reconnectTimer = undefined
			if (!this.isLive(entry) || entry.generation !== generation || entry.consumers.size === 0) {
				return
			}
			this.connectTransport(entry, reason)
		}, delay)
	}

	private reconnectTransport(entry: StreamEntry, reason: ReconnectReason, options: { resetAttempt?: boolean } = {}): void {
		if (!this.isLive(entry) || entry.consumers.size === 0) {
			return
		}
		if (options.resetAttempt) {
			entry.reconnectAttempt = 0
		}
		this.clearReconnectTimer(entry)
		this.connectTransport(entry, reason)
	}

	private teardownTransport(entry: StreamEntry, _options: { sendCancel: boolean }): void {
		if (entry.cancel) {
			try {
				entry.cancel()
			} catch (error) {
				console.error(`${QUIET_ERROR_PREFIX} Cancel failed for "${entry.definition.key}":`, error)
			}
			entry.cancel = null
		}
		entry.connecting = false
	}

	private dispatchMessage(entry: StreamEntry, response: unknown): void {
		for (const consumer of entry.consumers.values()) {
			try {
				;(consumer.handlers.onMessage as (msg: unknown) => void)(response)
			} catch (error) {
				console.error(`${QUIET_ERROR_PREFIX} onMessage callback failed for "${entry.definition.key}":`, error)
			}
		}
	}

	private resetStaleTimer(entry: StreamEntry, generation: number): void {
		this.clearStaleTimer(entry)
		const staleAfterMs = entry.definition.staleAfterMs
		if (staleAfterMs == null || staleAfterMs <= 0) {
			return
		}

		entry.staleTimer = setTimeout(() => {
			entry.staleTimer = undefined
			if (!this.isLive(entry) || entry.generation !== generation || entry.consumers.size === 0) {
				return
			}
			this.setState(entry, "stale")
			this.reconnectTransport(entry, "stale_heartbeat", { resetAttempt: true })
		}, staleAfterMs)
	}

	private clearReconnectTimer(entry: StreamEntry): void {
		if (entry.reconnectTimer) {
			clearTimeout(entry.reconnectTimer)
			entry.reconnectTimer = undefined
		}
	}

	private clearStaleTimer(entry: StreamEntry): void {
		if (entry.staleTimer) {
			clearTimeout(entry.staleTimer)
			entry.staleTimer = undefined
		}
	}

	private setState(entry: StreamEntry, state: SubscriptionHealthState): void {
		if (!this.isLive(entry) || entry.state === state) {
			return
		}
		entry.state = state
		for (const consumer of entry.consumers.values()) {
			try {
				consumer.handlers.onHealthChange?.(state)
			} catch (error) {
				console.error(`${QUIET_ERROR_PREFIX} onHealthChange callback failed:`, error)
			}
		}
		this.notifyHealthChange()
	}

	private toSnapshot(entry: StreamEntry): GrpcSubscriptionSnapshot {
		return {
			key: entry.definition.key,
			debugLabel: entry.definition.debugLabel ?? entry.definition.key,
			state: entry.state,
			refCount: Math.max(0, entry.consumers.size),
			reconnectAttempt: entry.reconnectAttempt,
			lastEventAt: entry.lastEventAt,
			lastError: entry.lastError,
			lastReconnectReason: entry.lastReconnectReason,
			hasActiveTransport: entry.cancel != null,
		}
	}

	private notifyHealthChange(): void {
		const snapshots = this.getSnapshots()
		for (const listener of this.healthListeners) {
			try {
				listener(snapshots)
			} catch (error) {
				console.error(`${QUIET_ERROR_PREFIX} Health listener failed:`, error)
			}
		}
	}

	private ensureLifecycleListeners(): void {
		if (this.lifecycleListenersAttached || typeof document === "undefined") {
			return
		}
		this.lifecycleListenersAttached = true

		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") {
				this.reconnectStale("visibility_restore")
			}
		})

		window.addEventListener("focus", () => {
			this.reconnectStale("visibility_restore")
		})
	}
}

export const grpcSubscriptionRuntime = new GrpcSubscriptionRuntime()

export { DEFAULT_RECONNECT_POLICY, DEFAULT_STALE_AFTER_MS, isDegradedState, isHealthyState }
