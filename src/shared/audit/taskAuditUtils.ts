import type { HardeningGrade, IntentClassification, TaskAuditMetadata } from "./types"

export type { HardeningGrade, IntentClassification, TaskAuditMetadata }

export interface HardeningAssessment {
	score: number
	grade: HardeningGrade
	criticalCount: number
	warningCount: number
}

/** Industry-style severity weights for policy violations (higher = more severe). */
const VIOLATION_WEIGHTS: Record<string, number> = {
	result_empty: 40,
	reported_blocker: 35,
	missing_validation_evidence: 30,
	security_leak: 50,
	stalled_task_timeout: 25,
	result_too_short: 15,
}

const DEFAULT_VIOLATION_WEIGHT = 12
const UNRESOLVED_MARKER_WEIGHT = 20
const JOY_ZONING_WEIGHT = 18

export const INTENT_CLASSIFICATION_STYLES: Record<IntentClassification, string> = {
	FIX: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30",
	CREATE: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
	REFACTOR: "bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30",
	TEST: "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30",
	INVESTIGATE: "bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30",
	CONFIGURE: "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30",
	DELETE: "bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30",
	GENERAL: "bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30",
}

export function getIntentClassification(intent?: string): IntentClassification {
	if (intent && intent in INTENT_CLASSIFICATION_STYLES) {
		return intent as IntentClassification
	}
	return "GENERAL"
}

export function formatEntropyScore(score?: number): string {
	return Number.isFinite(score) ? score!.toFixed(2) : "0.00"
}

export function getIntentCoveragePercentage(coverage?: number): number {
	if (!Number.isFinite(coverage)) {
		return 0
	}
	return Math.max(0, Math.min(100, Math.round(coverage! * 100)))
}

export function formatAuditDateTime(timestamp?: number): string {
	if (!Number.isFinite(timestamp)) {
		return "N/A"
	}
	const date = new Date(timestamp!)
	return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleString()
}

export function formatAuditTime(timestamp?: number): string {
	if (!Number.isFinite(timestamp)) {
		return "N/A"
	}
	const date = new Date(timestamp!)
	return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleTimeString()
}

export function getAuditReportId(timestamp?: number): string | undefined {
	if (!Number.isFinite(timestamp)) {
		return undefined
	}
	return `audit_${Math.floor(timestamp! / 1000)}`
}

export function formatViolationLabel(violation: string): string {
	return violation
		.replace(/^unresolved_work_marker:/, "Unresolved Marker: ")
		.replace(/^low_intent_coverage:/, "Low Intent Coverage: ")
		.replace(/^high_entropy_low_coverage:/, "High Entropy / Low Coverage: ")
		.replace(/_/g, " ")
}

function getViolationWeight(violation: string): number {
	if (VIOLATION_WEIGHTS[violation]) {
		return VIOLATION_WEIGHTS[violation]
	}
	if (violation.startsWith("unresolved_work_marker:")) {
		return UNRESOLVED_MARKER_WEIGHT
	}
	if (violation.startsWith("low_intent_coverage:") || violation.startsWith("high_entropy_low_coverage:")) {
		return 10
	}
	return DEFAULT_VIOLATION_WEIGHT
}

function scoreToGrade(score: number): HardeningGrade {
	if (score >= 90) return "A"
	if (score >= 80) return "B"
	if (score >= 70) return "C"
	if (score >= 60) return "D"
	return "F"
}

/**
 * Computes a 0–100 hardening score and letter grade from audit metadata.
 * Mirrors SRE maturity / compliance scoring patterns used in production gate systems.
 */
export function computeHardeningAssessment(metadata: {
	violations?: string[]
	joy_zoning_violations?: string[]
	entropy_score?: number
	intent_coverage?: number
}): HardeningAssessment {
	let penalty = 0
	let criticalCount = 0
	let warningCount = 0

	for (const violation of metadata.violations ?? []) {
		const weight = getViolationWeight(violation)
		penalty += weight
		if (weight >= 25) {
			criticalCount += 1
		} else {
			warningCount += 1
		}
	}

	for (const _joyViolation of metadata.joy_zoning_violations ?? []) {
		penalty += JOY_ZONING_WEIGHT
		warningCount += 1
	}

	if (Number.isFinite(metadata.entropy_score) && metadata.entropy_score! > 0.75) {
		penalty += 8
		warningCount += 1
	}

	if (Number.isFinite(metadata.intent_coverage) && metadata.intent_coverage! < 0.25) {
		penalty += 6
		warningCount += 1
	}

	const score = Math.max(0, Math.min(100, Math.round(100 - penalty)))
	return {
		score,
		grade: scoreToGrade(score),
		criticalCount,
		warningCount,
	}
}

export function enrichAuditMetadata(metadata: TaskAuditMetadata): TaskAuditMetadata {
	const assessment = computeHardeningAssessment(metadata)
	return {
		...metadata,
		hardening_score: assessment.score,
		hardening_grade: assessment.grade,
	}
}

export function buildAuditReportMarkdown(auditMetadata: TaskAuditMetadata): string {
	const policyViolations =
		auditMetadata.violations && auditMetadata.violations.length > 0
			? auditMetadata.violations.map(formatViolationLabel).join(", ")
			: "0 Violations (Fully Hardened)"
	const joyZoningViolations =
		auditMetadata.joy_zoning_violations && auditMetadata.joy_zoning_violations.length > 0
			? auditMetadata.joy_zoning_violations.join(", ")
			: "0 Violations (Compliant)"

	const gradeLine =
		auditMetadata.hardening_grade !== undefined
			? `- **Hardening Grade:** ${auditMetadata.hardening_grade} (${auditMetadata.hardening_score ?? "N/A"}/100)`
			: null

	return [
		"### ARCHITECTURAL HARDENING REPORT",
		`- **Intent Classification:** ${getIntentClassification(auditMetadata.intent_classification)}`,
		...(gradeLine ? [gradeLine] : []),
		`- **Result Checksum:** \`${auditMetadata.result_checksum || "N/A"}\``,
		`- **Structural Entropy:** ${formatEntropyScore(auditMetadata.entropy_score)}`,
		`- **Intent Coverage:** ${getIntentCoveragePercentage(auditMetadata.intent_coverage)}%`,
		`- **Alignment Status:** ${auditMetadata.divergence_detected ? "Divergent" : "Aligned"}`,
		`- **Policy Violations:** ${policyViolations}`,
		`- **Joy-Zoning Violations:** ${joyZoningViolations}`,
		`- **Audited At:** ${formatAuditDateTime(auditMetadata.audited_at)}`,
	].join("\n")
}

export const HARDENING_GRADE_STYLES: Record<HardeningGrade, string> = {
	A: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
	B: "bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30",
	C: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30",
	D: "bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30",
	F: "bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30",
}
