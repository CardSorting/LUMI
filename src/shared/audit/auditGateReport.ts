import { hasAuditScoreRegression } from "./auditRegression"
import { shouldEscalateFromAdvisory } from "./auditRollup"
import { hasCriticalViolations, partitionViolationsBySeverity } from "./auditSeverity"
import { COMPLETION_GATE_SCORE_THRESHOLD, resolveEffectiveGateThreshold } from "./gatePolicy"
import { computeHardeningAssessment, formatViolationLabel, getIntentClassification } from "./taskAuditUtils"
import type { CompletionGateReasonCode, IntentClassification, TaskAuditMetadata } from "./types"

export type { CompletionGateReasonCode } from "./types"

export interface CompletionGateReason {
	code: CompletionGateReasonCode
	message: string
}

export interface CompletionGateDecision {
	blocked: boolean
	score: number
	effectiveThreshold: number
	grade: TaskAuditMetadata["hardening_grade"]
	reasons: CompletionGateReason[]
}

export interface CompletionGateOptions {
	gateEnabled?: boolean
	scoreThreshold?: number
	criticalOnly?: boolean
	intentAdjustedThreshold?: boolean
	intentThresholdOverrides?: Partial<Record<IntentClassification, number>>
	advisoryMetadata?: TaskAuditMetadata
	advisoryEscalationEnabled?: boolean
	planBaselineMetadata?: TaskAuditMetadata
	planRegressionGateEnabled?: boolean
}

/** Unified quality-gate evaluator — mirrors CI/SonarQube gate decision APIs. */
export function evaluateCompletionGate(metadata: TaskAuditMetadata, options?: CompletionGateOptions): CompletionGateDecision {
	const assessment = computeHardeningAssessment(metadata)
	const score = metadata.hardening_score ?? assessment.score
	const grade = metadata.hardening_grade ?? assessment.grade
	const baseThreshold = options?.scoreThreshold ?? COMPLETION_GATE_SCORE_THRESHOLD
	const intent = getIntentClassification(metadata.intent_classification)
	const effectiveThreshold = resolveEffectiveGateThreshold(baseThreshold, intent, {
		intentAdjustmentsEnabled: options?.intentAdjustedThreshold !== false,
		overrides: options?.intentThresholdOverrides,
	})

	const reasons: CompletionGateReason[] = []

	if (options?.gateEnabled === false) {
		return {
			blocked: false,
			score,
			effectiveThreshold,
			grade,
			reasons: [{ code: "gate_disabled", message: "Completion gate disabled" }],
		}
	}

	if (options?.advisoryEscalationEnabled !== false && options?.advisoryMetadata) {
		if (shouldEscalateFromAdvisory(options.advisoryMetadata, metadata)) {
			reasons.push({
				code: "advisory_escalation",
				message: "Critical act-mode advisory findings remain unresolved",
			})
		}
	}

	if (options?.planRegressionGateEnabled !== false && options?.planBaselineMetadata) {
		if (hasAuditScoreRegression(options.planBaselineMetadata, metadata)) {
			reasons.push({
				code: "plan_regression",
				message: "Hardening score regressed from plan audit baseline",
			})
		}
	}

	if (score < effectiveThreshold) {
		if (options?.criticalOnly) {
			if (hasCriticalViolations(metadata.violations)) {
				reasons.push({
					code: "critical_violations",
					message: `Score ${score} below threshold ${effectiveThreshold} with critical violations`,
				})
			}
		} else if (assessment.criticalCount > 0 || (metadata.violations?.length ?? 0) > 0) {
			reasons.push({
				code: "score_below_threshold",
				message: `Score ${score} below threshold ${effectiveThreshold}`,
			})
		}
	}

	return {
		blocked: reasons.some((r) => r.code !== "gate_disabled"),
		score,
		effectiveThreshold,
		grade,
		reasons,
	}
}

export function isCompletionBlockedByDecision(decision: CompletionGateDecision): boolean {
	return decision.blocked
}

export function buildGateDecisionSummary(decision: CompletionGateDecision): string {
	if (!decision.blocked) {
		return `Gate ready: Grade ${decision.grade ?? "?"} (${decision.score}/100, threshold ${decision.effectiveThreshold})`
	}
	return decision.reasons.map((r) => `- ${r.message}`).join("\n")
}

export function buildPreCompletionChecklist(metadata: TaskAuditMetadata, options?: CompletionGateOptions): string {
	const decision = evaluateCompletionGate(metadata, options)
	const { critical, warning } = partitionViolationsBySeverity(metadata.violations)
	const lines = [
		"<pre_completion_checklist>",
		`Hardening: ${decision.grade ?? "?"} (${decision.score}/100) · Threshold ${decision.effectiveThreshold}`,
		decision.blocked ? "Status: BLOCKED — resolve before completing" : "Status: Gate ready",
	]

	if (critical.length > 0) {
		lines.push(`Critical (${critical.length}): ${critical.slice(0, 3).map(formatViolationLabel).join(", ")}`)
	}
	if (warning.length > 0) {
		lines.push(`Warnings (${warning.length}): ${warning.slice(0, 3).map(formatViolationLabel).join(", ")}`)
	}
	if (decision.reasons.length > 0) {
		for (const reason of decision.reasons) {
			if (reason.code !== "gate_disabled") {
				lines.push(`Gate: ${reason.message}`)
			}
		}
	}

	lines.push("</pre_completion_checklist>")
	return `\n\n${lines.join("\n")}`
}
