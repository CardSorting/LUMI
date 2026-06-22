import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { GateLifecycleDecision } from "./gateLifecycleDecision"

export type GateLifecycleFreshness = "current" | "stale" | "unknown"

export interface ResolvedGateLifecycleSnapshot {
	decision?: GateLifecycleDecision
	freshness: GateLifecycleFreshness
	evaluatedAt?: number
	continuityMarker?: string
	sourceMessageTs?: number
}

/** Gate snapshots older than this are shown as stale in the operator UI. */
export const GATE_LIFECYCLE_STALE_MS = 5 * 60 * 1000

export function getGateLifecycleContinuityMarker(decision: GateLifecycleDecision): string {
	if (decision.completionReceipt?.continuityMarker) {
		return decision.completionReceipt.continuityMarker
	}
	return `gate:${decision.reasonCode}:${decision.evaluatedAt}`
}

export function classifyGateLifecycleFreshness(
	evaluatedAt: number | undefined,
	now = Date.now(),
	staleAfterMs = GATE_LIFECYCLE_STALE_MS,
): GateLifecycleFreshness {
	if (typeof evaluatedAt !== "number" || !Number.isFinite(evaluatedAt)) {
		return "unknown"
	}
	return now - evaluatedAt <= staleAfterMs ? "current" : "stale"
}

export function resolveGateLifecycleSnapshot(
	messages: readonly DietCodeMessage[],
	options?: { now?: number; staleAfterMs?: number },
): ResolvedGateLifecycleSnapshot {
	const now = options?.now ?? Date.now()
	const staleAfterMs = options?.staleAfterMs ?? GATE_LIFECYCLE_STALE_MS

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		const decision = message?.gateLifecycleStatus
		if (!decision) {
			continue
		}

		const freshness = classifyGateLifecycleFreshness(decision.evaluatedAt, now, staleAfterMs)
		return {
			decision,
			freshness,
			evaluatedAt: decision.evaluatedAt,
			continuityMarker: getGateLifecycleContinuityMarker(decision),
			sourceMessageTs: message.ts,
		}
	}

	return { freshness: "unknown" }
}

export function getLatestGateLifecycleFromMessages(messages: readonly DietCodeMessage[]): GateLifecycleDecision | undefined {
	return resolveGateLifecycleSnapshot(messages).decision
}
