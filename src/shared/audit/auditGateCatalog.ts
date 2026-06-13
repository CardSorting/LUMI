import type { CompletionGateDecision, CompletionGateReason } from "./auditGateReport"
import type { CompletionGateReasonCode, TaskAuditMetadata } from "./types"

/** Human-readable gate reason labels — mirrors SARIF rule short descriptions. */
export const GATE_REASON_LABELS: Record<CompletionGateReasonCode, string> = {
	score_below_threshold: "Score below quality threshold",
	critical_violations: "Critical violations present",
	policy_violations: "Policy violations detected",
	advisory_escalation: "Unresolved advisory findings escalated",
	plan_regression: "Hardening regressed from plan baseline",
	gate_disabled: "Completion gate disabled",
}

export const GATE_REASON_REMEDIATION: Partial<Record<CompletionGateReasonCode, string>> = {
	score_below_threshold: "Improve hardening score by resolving violations and adding verification evidence.",
	critical_violations: "Resolve all critical-severity violations before completing.",
	policy_violations: "Resolve new violations introduced since the workspace baseline.",
	advisory_escalation: "Address act-mode advisory findings flagged during progress updates.",
	plan_regression: "Restore hardening score to at least the plan audit baseline level.",
}

export function formatGateReasonLabel(code: CompletionGateReasonCode): string {
	return GATE_REASON_LABELS[code] ?? code
}

export function formatGateReasonsForDisplay(reasons: CompletionGateReason[]): string[] {
	return reasons
		.filter((r) => r.code !== "gate_disabled")
		.map((r) => {
			const label = formatGateReasonLabel(r.code)
			const remediation = GATE_REASON_REMEDIATION[r.code]
			return remediation ? `${label}: ${remediation}` : r.message
		})
}

/** Builds display-ready gate reason lines from persisted audit metadata — DRY for chat UI. */
export function buildGateReasonLinesFromMetadata(
	metadata: TaskAuditMetadata,
	reasonCodes?: CompletionGateReasonCode[],
): string[] {
	const codes = reasonCodes ?? metadata.gate_reason_codes ?? []
	return formatGateReasonsForDisplay(
		codes
			.filter((code) => code !== "gate_disabled")
			.map((code) => ({
				code,
				message: formatGateReasonLabel(code),
			})),
	)
}

export function enrichAuditMetadataWithGateDecision(
	metadata: TaskAuditMetadata,
	decision: CompletionGateDecision,
	blockCount?: number,
): TaskAuditMetadata {
	return {
		...metadata,
		gate_blocked: decision.blocked,
		gate_block_count: blockCount,
		gate_reason_codes: decision.reasons.map((r) => r.code),
		gate_effective_threshold: decision.effectiveThreshold,
	}
}

export function buildGateBlockEventSummary(decision: CompletionGateDecision, blockCount?: number): string {
	const attempt = blockCount && blockCount > 0 ? ` (attempt ${blockCount})` : ""
	const status = decision.blocked ? "blocked" : "passed"
	const reasonLines = formatGateReasonsForDisplay(decision.reasons)
	return [
		`Audit gate ${status}${attempt}: Grade ${decision.grade ?? "?"} (${decision.score}/100, threshold ${decision.effectiveThreshold}).`,
		...reasonLines.map((line) => `- ${line}`),
	].join("\n")
}
