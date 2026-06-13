import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { shouldEmitAdvisoryAuditEvent } from "./auditAdvisoryDedup"
import { formatGateReasonsForDisplay } from "./auditGateCatalog"
import { type CompletionGateDecision, type CompletionGateOptions, evaluateCompletionGate } from "./auditGateReport"
import { buildAdvisoryEscalationSection } from "./auditPostTool"
import { buildRegressionGateSection, hasAuditScoreRegression } from "./auditRegression"
import { buildAdvisoryRollupSection, shouldEscalateFromAdvisory } from "./auditRollup"
import { partitionViolationsBySeverity } from "./auditSeverity"
import { getViolationRemediation } from "./auditViolationRemediation"
import { COMPLETION_GATE_SCORE_THRESHOLD } from "./gatePolicy"
import {
	buildAuditReportMarkdown,
	computeHardeningAssessment,
	formatViolationLabel,
	getIntentClassification,
} from "./taskAuditUtils"

export { COMPLETION_GATE_SCORE_THRESHOLD }

export async function persistCompletionAudit(streamId: string, metadata: TaskAuditMetadata): Promise<void> {
	await orchestrator.persistTaskAudit(streamId, metadata)
}

export { getViolationRemediation } from "./auditViolationRemediation"

export function isCompletionBlockedByAudit(metadata: TaskAuditMetadata, options?: CompletionGateOptions): boolean {
	return evaluateCompletionGate(metadata, options).blocked
}

export function buildCompletionGateMessage(
	metadata: TaskAuditMetadata,
	options?: {
		scoreThreshold?: number
		criticalOnly?: boolean
		intentAdjustedThreshold?: boolean
		intentThresholdOverrides?: Partial<Record<import("./types").IntentClassification, number>>
		advisoryMetadata?: TaskAuditMetadata
		planBaselineMetadata?: TaskAuditMetadata
		gateDecision?: CompletionGateDecision
	},
): string {
	const gateDecision =
		options?.gateDecision ??
		evaluateCompletionGate(metadata, {
			scoreThreshold: options?.scoreThreshold,
			criticalOnly: options?.criticalOnly,
			intentAdjustedThreshold: options?.intentAdjustedThreshold,
			intentThresholdOverrides: options?.intentThresholdOverrides,
			advisoryMetadata: options?.advisoryMetadata,
			planBaselineMetadata: options?.planBaselineMetadata,
		})
	const baseThreshold = options?.scoreThreshold ?? COMPLETION_GATE_SCORE_THRESHOLD
	const intent = getIntentClassification(metadata.intent_classification)
	const threshold = gateDecision.effectiveThreshold
	const assessment = computeHardeningAssessment(metadata)
	const violations = metadata.violations ?? []
	const { critical, warning } = partitionViolationsBySeverity(violations)
	const displayViolations = options?.criticalOnly ? critical : violations
	const remediationLines = displayViolations
		.map((v) => {
			const hint = getViolationRemediation(v)
			return hint ? `- **${formatViolationLabel(v)}**: ${hint}` : `- **${formatViolationLabel(v)}**`
		})
		.slice(0, 6)

	const gateReasonLines = formatGateReasonsForDisplay(gateDecision.reasons).map((line) => `- **Gate:** ${line}`)

	const joyLines = metadata.joy_zoning_violations?.map((v) => `- Architecture signal: \`${v}\``).slice(0, 3) ?? []

	const intentNote =
		threshold !== baseThreshold && options?.intentAdjustedThreshold !== false
			? ` (base ${baseThreshold}, +${threshold - baseThreshold} for ${intent} intent)`
			: ""

	return [
		"⛔ COMPLETION BLOCKED — Architectural hardening audit failed.",
		`Grade: **${metadata.hardening_grade ?? assessment.grade}** (${metadata.hardening_score ?? assessment.score}/100, threshold ${threshold}${intentNote}).`,
		options?.criticalOnly && warning.length > 0
			? `\n_Note: ${warning.length} warning-level violation(s) did not trigger the gate._`
			: "",
		gateReasonLines.length > 0 ? `\n**Gate reasons:**\n${gateReasonLines.join("\n")}` : "",
		"",
		"Resolve the following before calling attempt_completion again:",
		...remediationLines,
		...joyLines,
		"",
		"Re-verify your work, address every violation, then retry completion.",
		buildAdvisoryRollupSection(options?.advisoryMetadata, metadata),
		options?.advisoryMetadata && shouldEscalateFromAdvisory(options.advisoryMetadata, metadata)
			? buildAdvisoryEscalationSection(options.advisoryMetadata)
			: "",
		options?.planBaselineMetadata && hasAuditScoreRegression(options.planBaselineMetadata, metadata)
			? buildRegressionGateSection(options.planBaselineMetadata, metadata)
			: "",
	].join("\n")
}

export function buildDoubleCheckAuditSection(metadata: TaskAuditMetadata): string {
	if (!metadata.divergence_detected) {
		return ""
	}
	const assessment = computeHardeningAssessment(metadata)
	const topViolations = (metadata.violations ?? []).slice(0, 3).map(formatViolationLabel)
	if (topViolations.length === 0) {
		return ""
	}
	return (
		`\n\n<audit_preview grade="${metadata.hardening_grade ?? assessment.grade}" score="${metadata.hardening_score ?? assessment.score}">` +
		`\nPreliminary audit flagged: ${topViolations.join(", ")}` +
		`\nAddress these during re-verification.` +
		`\n</audit_preview>`
	)
}

export async function runCompletionAudit(
	taskId: string,
	taskDescription: string,
	result: string,
	streamFocusFallback = "",
): Promise<TaskAuditMetadata> {
	const streamFocus = await orchestrator.resolveStreamFocus(taskId, taskDescription || streamFocusFallback)
	const metadata = await orchestrator.auditTask(taskId, taskDescription, result, streamFocus || taskDescription)
	await persistCompletionAudit(taskId, metadata)
	return metadata
}

/** Lightweight audit for act-mode progress updates — advisory only, no trail persistence. */
export async function runAdvisoryAudit(
	taskId: string,
	taskDescription: string,
	result: string,
	streamFocusFallback = "",
): Promise<TaskAuditMetadata> {
	const streamFocus = await orchestrator.resolveStreamFocus(taskId, taskDescription || streamFocusFallback)
	return orchestrator.auditTask(taskId, taskDescription, result, streamFocus || taskDescription)
}

export { shouldEmitAdvisoryAuditEvent } from "./auditAdvisoryDedup"

export function buildActModeAuditAdvisory(metadata: TaskAuditMetadata): string {
	if (!shouldEmitAdvisoryAuditEvent(metadata)) {
		return ""
	}
	const assessment = computeHardeningAssessment(metadata)
	const topViolations = (metadata.violations ?? []).slice(0, 3).map(formatViolationLabel)
	if (topViolations.length === 0) {
		return ""
	}
	const hints = (metadata.violations ?? [])
		.slice(0, 2)
		.map((v) => getViolationRemediation(v))
		.filter(Boolean)
	return (
		`\n\n<audit_advisory grade="${metadata.hardening_grade ?? assessment.grade}" score="${metadata.hardening_score ?? assessment.score}">` +
		`\nProgress update flagged: ${topViolations.join(", ")}.` +
		(hints.length > 0 ? `\nRemediation: ${hints.join(" ")}` : "") +
		`\nAddress before calling attempt_completion.` +
		`\n</audit_advisory>`
	)
}

export function buildAdvisoryAuditEventSummary(metadata: TaskAuditMetadata, previousMetadata?: TaskAuditMetadata): string {
	const assessment = computeHardeningAssessment(metadata)
	const newViolations = previousMetadata
		? (metadata.violations ?? []).filter((v) => !(previousMetadata.violations ?? []).includes(v))
		: (metadata.violations ?? [])
	const topViolations = (metadata.violations ?? []).slice(0, 4).map(formatViolationLabel)
	const remediation = (metadata.violations ?? [])
		.slice(0, 2)
		.map((v) => getViolationRemediation(v))
		.filter(Boolean)
	return [
		`Act-mode audit advisory: Grade ${metadata.hardening_grade ?? assessment.grade} (${metadata.hardening_score ?? assessment.score}/100).`,
		newViolations.length > 0 && previousMetadata
			? `New since last advisory: ${newViolations.slice(0, 4).map(formatViolationLabel).join(", ")}.`
			: undefined,
		topViolations.length > 0 ? `Flagged: ${topViolations.join(", ")}.` : undefined,
		remediation.length > 0 ? `Remediation: ${remediation.join(" ")}` : undefined,
		"Address before calling attempt_completion.",
	]
		.filter(Boolean)
		.join("\n")
}

export { buildAuditReportMarkdown }

export type { AuditHookMetadataOptions } from "./auditHookMetadata"
export { buildAuditHookMetadata, SARIF_HOOK_EXPORT_MAX_CHARS } from "./auditHookMetadata"
