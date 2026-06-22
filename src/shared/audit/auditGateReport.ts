import { filterNewViolationsSinceBaseline } from "./auditBaseline"
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

export interface AuditGateDecision {
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
	/** When true, only violations not in workspace baseline block the gate — SonarQube new-code pattern. */
	newViolationsOnly?: boolean
	baselineMetadata?: TaskAuditMetadata
}

/** Unified quality-gate evaluator — mirrors CI/SonarQube gate decision APIs. */
export function evaluateAuditGate(metadata: TaskAuditMetadata, options?: CompletionGateOptions): AuditGateDecision {
	const gateViolations =
		options?.newViolationsOnly && options.baselineMetadata
			? filterNewViolationsSinceBaseline(metadata.violations, options.baselineMetadata)
			: (metadata.violations ?? [])

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

	if (options?.newViolationsOnly) {
		if (options.criticalOnly) {
			if (hasCriticalViolations(gateViolations)) {
				reasons.push({
					code: "critical_violations",
					message: `${gateViolations.length} new critical violation(s) since baseline`,
				})
			}
		} else if (gateViolations.length > 0) {
			reasons.push({
				code: "policy_violations",
				message: `${gateViolations.length} new violation(s) since baseline`,
			})
		}
	} else if (score < effectiveThreshold) {
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

export function isCompletionBlockedByDecision(decision: AuditGateDecision): boolean {
	return decision.blocked
}

export function buildGateDecisionSummary(decision: AuditGateDecision): string {
	if (!decision.blocked) {
		return `Gate ready: Grade ${decision.grade ?? "?"} (${decision.score}/100, threshold ${decision.effectiveThreshold})`
	}
	return decision.reasons.map((r) => `- ${r.message}`).join("\n")
}

export function buildPreCompletionChecklist(metadata: TaskAuditMetadata, options?: CompletionGateOptions): string {
	const decision = evaluateAuditGate(metadata, options)
	const gateViolations =
		options?.newViolationsOnly && options.baselineMetadata
			? filterNewViolationsSinceBaseline(metadata.violations, options.baselineMetadata)
			: (metadata.violations ?? [])
	const { critical, warning } = partitionViolationsBySeverity(gateViolations)
	const allViolations = metadata.violations ?? []
	const grandfatheredCount =
		options?.newViolationsOnly && options.baselineMetadata ? Math.max(0, allViolations.length - gateViolations.length) : 0
	const lines = [
		"<pre_completion_checklist>",
		`Hardening: ${decision.grade ?? "?"} (${decision.score}/100) · Threshold ${decision.effectiveThreshold}`,
		decision.blocked ? "Status: BLOCKED — resolve before completing" : "Status: Gate ready",
	]

	if (options?.newViolationsOnly) {
		lines.push(`New-code gate: ${gateViolations.length} blocking violation(s) since baseline`)
		if (grandfatheredCount > 0) {
			lines.push(`Grandfathered (${grandfatheredCount}): legacy debt excluded from gate _(baseline policy)_`)
		}
	}

	if (critical.length > 0) {
		lines.push(`Critical (${critical.length}): ${critical.slice(0, 3).map(formatViolationLabel).join(", ")}`)
	}
	if (warning.length > 0) {
		lines.push(`Warnings (${warning.length}): ${warning.slice(0, 3).map(formatViolationLabel).join(", ")}`)
	}
	const suppressed = metadata.suppressed_violations ?? []
	if (suppressed.length > 0) {
		lines.push(`Suppressed (${suppressed.length}): ${suppressed.slice(0, 3).map(formatViolationLabel).join(", ")} _(waived)_`)
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
