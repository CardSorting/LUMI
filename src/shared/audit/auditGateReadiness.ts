import { type CompletionGateOptions, evaluateAuditGate } from "./auditGateReport"
import type { TaskAuditMetadata } from "./types"

export type GateReadinessLevel = "ready" | "warning" | "blocked" | "disabled"

export interface GateReadinessSummary {
	level: GateReadinessLevel
	label: string
	shortLabel: string
	tooltip: string
}

export function describeGateReadiness(
	metadata: TaskAuditMetadata | undefined,
	options?: CompletionGateOptions,
): GateReadinessSummary {
	if (options?.gateEnabled === false) {
		return {
			level: "disabled",
			label: "Gate disabled",
			shortLabel: "Off",
			tooltip: "Completion gate is disabled — advisory only",
		}
	}
	if (!metadata?.hardening_grade) {
		return {
			level: "warning",
			label: "No audit yet",
			shortLabel: "Pending",
			tooltip: "No hardening audit available for this task",
		}
	}

	const decision = evaluateAuditGate(metadata, options)
	if (decision.blocked || metadata.gate_blocked) {
		const reasons = decision.reasons
			.filter((r) => r.code !== "gate_disabled")
			.map((r) => r.message)
			.join("; ")
		return {
			level: "blocked",
			label: "Gate blocked",
			shortLabel: "Blocked",
			tooltip: reasons || `Score ${decision.score} below threshold ${decision.effectiveThreshold}`,
		}
	}

	if ((metadata.violations?.length ?? 0) > 0 || decision.score < decision.effectiveThreshold + 15) {
		const advisoryCount = options?.advisoryMetadata?.violations?.length ?? 0
		const advisoryNote = advisoryCount > 0 ? ` · ${advisoryCount} unresolved act-mode advisory finding(s)` : ""
		return {
			level: "warning",
			label: "Gate marginal",
			shortLabel: "Marginal",
			tooltip: `Grade ${metadata.hardening_grade} (${decision.score}/100) — resolve warnings before completing${advisoryNote}`,
		}
	}

	const pendingAdvisoryCount = options?.advisoryMetadata?.violations?.length ?? 0
	if (pendingAdvisoryCount > 0) {
		return {
			level: "warning",
			label: "Gate marginal",
			shortLabel: "Advisory",
			tooltip: `${pendingAdvisoryCount} act-mode advisory finding(s) — resolve before completing`,
		}
	}

	return {
		level: "ready",
		label: "Gate ready",
		shortLabel: "Ready",
		tooltip: `Grade ${metadata.hardening_grade} (${decision.score}/100, threshold ${decision.effectiveThreshold})`,
	}
}

export function serializeIntentThresholdOverrides(overrides: Partial<Record<string, number>>): string {
	const cleaned: Record<string, number> = {}
	for (const [key, value] of Object.entries(overrides)) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			cleaned[key] = Math.round(value)
		}
	}
	return JSON.stringify(cleaned)
}
