import { formatGateReasonLabel } from "./auditGateCatalog"
import { describeGateReadiness } from "./auditGateReadiness"
import type { CompletionGateOptions } from "./auditGateReport"
import { partitionViolationsBySeverity } from "./auditSeverity"
import { formatViolationLabel } from "./taskAuditUtils"
import type { CompletionGateReasonCode, TaskAuditMetadata } from "./types"

export interface SubagentAuditContextInput {
	lastCompletionAudit?: TaskAuditMetadata
	lastAdvisoryAudit?: TaskAuditMetadata
	completionGateBlockCount?: number
	gateOptions?: CompletionGateOptions
}

/** Machine-readable gate signals for subagent `criticalSignals` — mirrors CI status checks. */
export function buildSubagentGateSignals(input: SubagentAuditContextInput): string[] {
	if (input.gateOptions?.gateEnabled === false) {
		return []
	}

	const signals: string[] = []

	if (input.completionGateBlockCount && input.completionGateBlockCount > 0) {
		signals.push(`GATE: PARENT_BLOCKED (${input.completionGateBlockCount})`)
	}

	if (input.lastCompletionAudit?.gate_blocked) {
		signals.push("SIGNAL: PARENT_COMPLETION_GATE_BLOCKED")
	}

	const readiness = describeGateReadiness(input.lastCompletionAudit, input.gateOptions)
	if (readiness.level === "blocked") {
		signals.push("SIGNAL: PARENT_GATE_BLOCKED")
	} else if (readiness.level === "warning") {
		signals.push("SIGNAL: PARENT_GATE_MARGINAL")
	}

	const { critical } = partitionViolationsBySeverity(input.lastCompletionAudit?.violations)
	if (critical.length > 0) {
		signals.push("SIGNAL: PARENT_CRITICAL_VIOLATIONS")
	}

	if (input.lastAdvisoryAudit?.violations?.length) {
		signals.push("SIGNAL: PARENT_ADVISORY_FINDINGS")
	}

	return Array.from(new Set(signals))
}

/** Compact audit brief for subagent system context — mirrors parent CI gate status handoff. */
export function buildSubagentAuditContext(input: SubagentAuditContextInput): string {
	const { lastCompletionAudit, lastAdvisoryAudit, completionGateBlockCount } = input
	if (!lastCompletionAudit && !lastAdvisoryAudit && !completionGateBlockCount) {
		return ""
	}

	const lines = ["<parent_audit_context>", "Parent task hardening status:"]

	if (lastCompletionAudit) {
		lines.push(
			`- Last completion audit: Grade ${lastCompletionAudit.hardening_grade ?? "?"} (${lastCompletionAudit.hardening_score ?? "?"}/100)`,
		)
		if (lastCompletionAudit.gate_blocked) {
			lines.push("- Completion gate: BLOCKED")
		}
		const { critical } = partitionViolationsBySeverity(lastCompletionAudit.violations)
		if (critical.length > 0) {
			lines.push(`- Critical violations: ${critical.slice(0, 3).map(formatViolationLabel).join(", ")}`)
		}
		if (lastCompletionAudit.gate_reason_codes?.length) {
			const labels = lastCompletionAudit.gate_reason_codes
				.filter((c): c is CompletionGateReasonCode => c !== "gate_disabled")
				.map(formatGateReasonLabel)
			if (labels.length > 0) {
				lines.push(`- Gate reasons: ${labels.join("; ")}`)
			}
		}
	}

	if (lastAdvisoryAudit) {
		const advisoryViolations = lastAdvisoryAudit.violations?.slice(0, 3).map(formatViolationLabel) ?? []
		if (advisoryViolations.length > 0) {
			lines.push(`- Unresolved advisory findings: ${advisoryViolations.join(", ")}`)
		}
	}

	if (completionGateBlockCount && completionGateBlockCount > 0) {
		lines.push(`- Completion gate blocks this task: ${completionGateBlockCount}`)
	}

	lines.push("Align subagent work with parent hardening requirements.", "</parent_audit_context>")
	return lines.join("\n")
}
