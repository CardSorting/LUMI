/**
 * Canonical contract for long-lived gRPC event subscriptions (webview ↔ extension).
 * Single source of truth — do not duplicate heuristics elsewhere.
 */

export type SubscriptionHealthState =
	| "idle"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "degraded"
	| "stale"
	| "disconnected"
	| "failed"

export type ReconnectReason =
	| "stream_error"
	| "stream_complete"
	| "visibility_restore"
	| "stale_heartbeat"
	| "transport_reset"
	| "handler_replacement"
	| "manual"

export interface ReconnectPolicy {
	initialDelayMs: number
	maxDelayMs: number
	multiplier: number
	jitterRatio: number
	maxAttempts: number
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
	initialDelayMs: 250,
	maxDelayMs: 30_000,
	multiplier: 2,
	jitterRatio: 0.2,
	maxAttempts: 50,
}

/** Finite streams (e.g. triggerAudit) use idle timeout; persistent subscriptions do not. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_UNARY_TIMEOUT_MS = 60_000

/** Optional staleness watchdog for data streams that should receive periodic updates. */
export const DEFAULT_STALE_AFTER_MS = 10 * 60_000

export function isPersistentStreamingMethod(methodName: string): boolean {
	const method = methodName.toLowerCase()
	return method.startsWith("subscribe") || method.includes("subscription")
}

export function shouldApplyStreamIdleTimeout(methodName: string): boolean {
	return !isPersistentStreamingMethod(methodName)
}

export function buildSubscriptionKey(service: string, method: string): string {
	return `${service}.${method}`
}

export function getSubscriptionDebugLabel(key: string, label?: string): string {
	return label ?? key
}

export function computeBackoffDelay(attempt: number, partial?: Partial<ReconnectPolicy>): number {
	const policy: ReconnectPolicy = { ...DEFAULT_RECONNECT_POLICY, ...partial }
	const exponential = Math.min(policy.initialDelayMs * policy.multiplier ** attempt, policy.maxDelayMs)
	const jitter = exponential * policy.jitterRatio * (Math.random() * 2 - 1)
	return Math.max(0, Math.round(exponential + jitter))
}

export function mergeReconnectPolicy(partial?: Partial<ReconnectPolicy>): ReconnectPolicy {
	return { ...DEFAULT_RECONNECT_POLICY, ...partial }
}

export function isReconnectEligible(state: SubscriptionHealthState): boolean {
	return state !== "failed" && state !== "idle"
}

export function isHealthyState(state: SubscriptionHealthState): boolean {
	return state === "connected"
}

export function isDegradedState(state: SubscriptionHealthState): boolean {
	return state === "reconnecting" || state === "degraded" || state === "stale"
}

export function isTerminalFailedState(state: SubscriptionHealthState): boolean {
	return state === "failed"
}

/** Failed is terminal while consumers remain; a fresh acquire after full teardown starts clean. */
export function shouldRecoverFromFailedOnAcquire(state: SubscriptionHealthState): boolean {
	return state === "failed"
}
