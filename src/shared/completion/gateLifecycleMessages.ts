import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { CanonicalLifecycleDecision } from "./canonicalLifecycleDecision"
import type { GateLifecycleDecision } from "./gateLifecycleDecision"

export type GateLifecycleFreshness = "current" | "stale" | "unknown"

/**
 * Operator-facing reconciliation label — replaces "stale" in all user-facing UX.
 * "stale" remains as an internal implementation detail; this function is the
 * single mapping point from freshness to operator-visible language.
 */
export function getFreshnessReconciliationLabel(freshness: GateLifecycleFreshness): string {
	switch (freshness) {
		case "current":
			return "Synchronized"
		case "stale":
			return "Synchronizing execution state"
		case "unknown":
			return "Validating completion readiness"
	}
}

export interface ResolvedGateLifecycleSnapshot {
	decision?: GateLifecycleDecision
	/** Canonical lifecycle decision — takes precedence over `decision` when present. */
	canonicalDecision?: CanonicalLifecycleDecision
	freshness: GateLifecycleFreshness
	/** Operator-visible reconciliation label — never raw "stale". */
	reconciliationLabel: string
	evaluatedAt?: number
	continuityMarker?: string
	sourceMessageTs?: number
}

/** Gate snapshots older than this enter active reconciliation (was: "stale"). */
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
		const canonicalDecision = message?.canonicalLifecycleDecision
		if (canonicalDecision && !decision) {
			return {
				canonicalDecision,
				freshness: "current",
				reconciliationLabel: getFreshnessReconciliationLabel("current"),
				sourceMessageTs: message.ts,
			}
		}
		if (!decision) {
			continue
		}

		const isReady = decision.engineering === "passed"
		const freshness = isReady ? "current" : classifyGateLifecycleFreshness(decision.evaluatedAt, now, staleAfterMs)
		return {
			decision,
			canonicalDecision,
			freshness,
			reconciliationLabel: getFreshnessReconciliationLabel(freshness),
			evaluatedAt: decision.evaluatedAt,
			continuityMarker: getGateLifecycleContinuityMarker(decision),
			sourceMessageTs: message.ts,
		}
	}

	return { freshness: "unknown", reconciliationLabel: getFreshnessReconciliationLabel("unknown") }
}

export function getLatestGateLifecycleFromMessages(messages: readonly DietCodeMessage[]): GateLifecycleDecision | undefined {
	return resolveGateLifecycleSnapshot(messages).decision
}
