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
	lastCompletionFailedStage?: string
	completionAttemptCount?: number
	completionGatePressureLevel?: string
	completionGateObservabilityEnvelope?: string
	completionGateRetryStatus?: string
	completionGateBlockHistoryCount?: number
	completionGateSessionId?: string
	completionGateOperationalState?: string
	gateOptions?: CompletionGateOptions
	mode?: "plan" | "act"
	isStale?: boolean
}

/** Machine-readable gate signals for subagent `criticalSignals` — mirrors CI status checks. */
export function buildSubagentGateSignals(input: SubagentAuditContextInput): string[] {
	if (input.gateOptions?.gateEnabled === false) {
		return []
	}

	const signals: string[] = []

	if (input.completionGateBlockCount && input.completionGateBlockCount > 0) {
		signals.push(`ADVISORY: GATE: PARENT_BLOCKED (${input.completionGateBlockCount})`)
	}

	if (input.lastCompletionBlockReason) {
		signals.push(`ADVISORY: GATE: PARENT_LAST_REASON (${input.lastCompletionBlockReason})`)
	}

	if (input.lastCompletionFailedStage) {
		signals.push(`ADVISORY: GATE: PARENT_FAILED_STAGE (${input.lastCompletionFailedStage})`)
	}

	if (input.completionGatePressureLevel && input.completionGatePressureLevel !== "stable") {
		signals.push(`ADVISORY: GATE: PARENT_PRESSURE (${input.completionGatePressureLevel})`)
	}

	if (input.completionAttemptCount && input.completionAttemptCount > 0) {
		signals.push(`ADVISORY: GATE: PARENT_ATTEMPTS (${input.completionAttemptCount})`)
	}

	const retryStatus = input.completionGateRetryStatus
	if (retryStatus && retryStatus !== "ready") {
		signals.push(`ADVISORY: GATE: PARENT_RETRY_STATUS (${retryStatus})`)
	}

	if (input.completionGateBlockHistoryCount && input.completionGateBlockHistoryCount > 1) {
		signals.push(`ADVISORY: GATE: PARENT_DIAGNOSTIC_HISTORY (${input.completionGateBlockHistoryCount})`)
	}

	if (input.completionGateSessionId) {
		signals.push(`ADVISORY: GATE: PARENT_SESSION (${input.completionGateSessionId})`)
	}

	if (input.completionGateOperationalState && input.completionGateOperationalState !== "ready") {
		signals.push(`ADVISORY: GATE: PARENT_STATE (${input.completionGateOperationalState})`)
	}

	if (input.lastCompletionAudit?.gate_blocked) {
		signals.push("ADVISORY: SIGNAL: PARENT_COMPLETION_DIAGNOSTIC_FINDINGS")
	}

	const readiness = describeGateReadiness(input.lastCompletionAudit, input.gateOptions)
	if (readiness.level === "warning") {
		signals.push("ADVISORY: SIGNAL: PARENT_GATE_MARGINAL")
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
		lastCompletionFailedStage,
		completionAttemptCount,
		completionGatePressureLevel,
		completionGateObservabilityEnvelope,
		completionGateRetryStatus,
		mode,
		isStale,
	} = input

	if (mode === "act") {
		const lines = ["<parent_audit_context>", "Active Execution State Summary:"]

		if (isStale) {
			lines.push("- Workspace state: MODIFIED (prior completion audit findings are stale and may have been remediated)")
		} else if (lastCompletionAudit) {
			lines.push(`- Last audit score: ${lastCompletionAudit.hardening_score ?? "?"}/100`)
			const { critical } = partitionViolationsBySeverity(lastCompletionAudit.violations)
			if (critical.length > 0) {
				lines.push(`- Unresolved critical violations: ${critical.slice(0, 3).map(formatViolationLabel).join(", ")}`)
			}
		}

		if (completionGatePressureLevel && completionGatePressureLevel !== "stable") {
			lines.push(`- Execution pressure: ${completionGatePressureLevel}`)
		}

		lines.push(
			"",
			"EXECUTION DIRECTIVES:",
			"1. You are authorized to proceed with executing the task.",
			"2. Continue executing while a valid next action exists. Do not return to planning or request additional validation unless a named hard blocker prevents progress.",
			"3. When all required work and verification conditions are satisfied, call `attempt_completion`. Advisory warnings do not block completion.",
			"</parent_audit_context>",
		)
		return lines.join("\n")
	}

	if (
		!lastCompletionAudit &&
		!lastAdvisoryAudit &&
		!completionGateBlockCount &&
		!lastCompletionBlockReason &&
		!completionGateObservabilityEnvelope
	) {
		return ""
	}

	const lines = ["<parent_audit_context>", "Parent task hardening status:"]

	if (completionGateObservabilityEnvelope) {
		lines.push(completionGateObservabilityEnvelope)
	}

	if (lastCompletionAudit) {
		lines.push(
			`- Last completion audit: Grade ${lastCompletionAudit.hardening_grade ?? "?"} (${lastCompletionAudit.hardening_score ?? "?"}/100)`,
		)
		if (lastCompletionAudit.gate_blocked) {
			lines.push("- Completion diagnostics: ADVISORY FINDINGS")
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
				lines.push(`- Advisory reasons: ${labels.join("; ")}`)
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
		lines.push(`- Historical completion diagnostic findings: ${completionGateBlockCount}`)
		const remaining = MAX_COMPLETION_GATE_BLOCK_COUNT - completionGateBlockCount
		if (remaining > 0 && remaining <= 5) {
			lines.push(`- Advisory quality pressure marker: ${remaining}`)
		}
	}

	if (lastCompletionBlockReason) {
		lines.push(`- Last parent advisory diagnostic reason: ${lastCompletionBlockReason}`)
	}

	if (lastCompletionFailedStage) {
		lines.push(`- Last parent gate failed stage: ${lastCompletionFailedStage}`)
	}

	if (completionGatePressureLevel) {
		lines.push(`- Parent gate pressure level: ${completionGatePressureLevel}`)
	}

	if (completionGateRetryStatus) {
		lines.push(`- Parent gate retry status: ${completionGateRetryStatus}`)
	}

	const historyCount = input.completionGateBlockHistoryCount
	if (historyCount && historyCount > 0) {
		lines.push(`- Parent gate block history: ${historyCount} recent event(s)`)
	}

	if (input.completionGateSessionId) {
		lines.push(`- Parent gate session: ${input.completionGateSessionId}`)
	}

	if (input.completionGateOperationalState) {
		lines.push(`- Parent gate operational state: ${input.completionGateOperationalState}`)
	}

	if (completionAttemptCount && completionAttemptCount > 0) {
		lines.push(`- Parent completion attempts this task: ${completionAttemptCount}`)
	}

	lines.push("Align subagent work with parent hardening requirements.", "</parent_audit_context>")
	return lines.join("\n")
}
