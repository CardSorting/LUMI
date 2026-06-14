import { formatGateReasonLabel } from "./auditGateCatalog"
import { describeGateReadiness } from "./auditGateReadiness"
import type { CompletionGateOptions } from "./auditGateReport"
import { partitionViolationsBySeverity } from "./auditSeverity"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "./gatePolicy"
import { formatViolationLabel } from "./taskAuditUtils"
import type { CompletionGateReasonCode, TaskAuditMetadata } from "./types"

export interface SubagentAuditContextInput {
	lastCompletionAudit?: TaskAuditMetadata
	lastAdvisoryAudit?: TaskAuditMetadata
	completionGateBlockCount?: number
	lastCompletionBlockReason?: string
	completionAttemptCount?: number
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

	if (input.lastCompletionBlockReason) {
		signals.push(`GATE: PARENT_LAST_REASON (${input.lastCompletionBlockReason})`)
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

	if (input.lastCompletionAudit?.workspace_gate_policy_applied) {
		signals.push("SIGNAL: PARENT_WORKSPACE_GATE_POLICY")
	}

	if ((input.lastCompletionAudit?.suppressed_violations?.length ?? 0) > 0) {
		signals.push("SIGNAL: PARENT_SUPPRESSED_VIOLATIONS")
	}

	return Array.from(new Set(signals))
}

/** Compact audit brief for subagent system context — mirrors parent CI gate status handoff. */
export function buildSubagentAuditContext(input: SubagentAuditContextInput): string {
	const {
		lastCompletionAudit,
		lastAdvisoryAudit,
		completionGateBlockCount,
		lastCompletionBlockReason,
		completionAttemptCount,
	} = input
	if (!lastCompletionAudit && !lastAdvisoryAudit && !completionGateBlockCount && !lastCompletionBlockReason) {
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
		if (lastCompletionAudit.workspace_gate_policy_applied) {
			lines.push("- Workspace gate policy: APPLIED (.audit/gate-policy.json)")
		}
		const suppressedCount = lastCompletionAudit.suppressed_violations?.length ?? 0
		if (suppressedCount > 0) {
			lines.push(`- Suppressed violations: ${suppressedCount} waived`)
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
		const remaining = MAX_COMPLETION_GATE_BLOCK_COUNT - completionGateBlockCount
		if (remaining > 0 && remaining <= 5) {
			lines.push(`- Parent gate pressure: ${remaining} attempt(s) before hard stop`)
		}
	}

	if (lastCompletionBlockReason) {
		lines.push(`- Last parent gate block reason: ${lastCompletionBlockReason}`)
	}

	if (completionAttemptCount && completionAttemptCount > 0) {
		lines.push(`- Parent completion attempts this task: ${completionAttemptCount}`)
	}

	lines.push("Align subagent work with parent hardening requirements.", "</parent_audit_context>")
	return lines.join("\n")
}
