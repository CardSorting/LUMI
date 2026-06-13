import { hasCriticalViolations, partitionViolationsBySeverity } from "./auditSeverity"
import { formatViolationLabel } from "./taskAuditUtils"
import type { TaskAuditMetadata } from "./types"

/** Returns violations present in both audit snapshots (persistent drift). */
export function getPersistentViolations(
	earlier: TaskAuditMetadata | undefined,
	current: TaskAuditMetadata | undefined,
): string[] {
	if (!earlier?.violations?.length || !current?.violations?.length) {
		return []
	}
	const currentSet = new Set(current.violations)
	return earlier.violations.filter((v) => currentSet.has(v))
}

/** Detects whether advisory findings were not resolved before completion attempt. */
export function hasUnresolvedAdvisoryFindings(advisory: TaskAuditMetadata | undefined, completion: TaskAuditMetadata): boolean {
	const persistent = getPersistentViolations(advisory, completion)
	return persistent.length > 0
}

export function buildAdvisoryRollupSection(advisory: TaskAuditMetadata | undefined, completion: TaskAuditMetadata): string {
	if (!advisory) {
		return ""
	}
	const persistent = getPersistentViolations(advisory, completion)
	if (persistent.length === 0) {
		return ""
	}
	const labels = persistent.slice(0, 4).map(formatViolationLabel)
	return (
		`\n\n**Advisory Rollup:** ${persistent.length} issue(s) flagged during act-mode progress remain unresolved:\n` +
		labels.map((l) => `- ${l}`).join("\n")
	)
}

export interface AuditHealthSummary {
	snapshotCount: number
	averageScore: number
	latestGrade?: TaskAuditMetadata["hardening_grade"]
	criticalViolationCount: number
	warningViolationCount: number
	gateBlockCount: number
	suppressedViolationCount: number
	trend: "improving" | "degrading" | "stable" | "unknown"
}

export function computeAuditHealthSummary(
	snapshots: Array<{ auditMetadata: TaskAuditMetadata }>,
): AuditHealthSummary | undefined {
	if (snapshots.length === 0) {
		return undefined
	}

	let scoreSum = 0
	let scoredCount = 0
	let criticalViolationCount = 0
	let warningViolationCount = 0
	let gateBlockCount = 0
	let suppressedViolationCount = 0

	for (const { auditMetadata } of snapshots) {
		if (auditMetadata.gate_blocked) {
			gateBlockCount += 1
		}
		suppressedViolationCount += auditMetadata.suppressed_violations?.length ?? 0
		if (Number.isFinite(auditMetadata.hardening_score)) {
			scoreSum += auditMetadata.hardening_score!
			scoredCount += 1
		}
		const partitioned = partitionViolationsBySeverity(auditMetadata.violations)
		criticalViolationCount += partitioned.critical.length
		warningViolationCount += partitioned.warning.length
	}

	const latest = snapshots[snapshots.length - 1].auditMetadata
	const earliest = snapshots[0].auditMetadata
	const latestScore = latest.hardening_score
	const earliestScore = earliest.hardening_score

	let trend: AuditHealthSummary["trend"] = "unknown"
	if (Number.isFinite(latestScore) && Number.isFinite(earliestScore) && snapshots.length > 1) {
		const delta = latestScore! - earliestScore!
		if (delta >= 5) trend = "improving"
		else if (delta <= -5) trend = "degrading"
		else trend = "stable"
	}

	return {
		snapshotCount: snapshots.length,
		averageScore: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : 0,
		latestGrade: latest.hardening_grade,
		criticalViolationCount,
		warningViolationCount,
		gateBlockCount,
		suppressedViolationCount,
		trend,
	}
}

export function shouldEscalateFromAdvisory(advisory: TaskAuditMetadata | undefined, completion: TaskAuditMetadata): boolean {
	if (!advisory) return false
	if (!hasCriticalViolations(advisory.violations)) return false
	return hasUnresolvedAdvisoryFindings(advisory, completion)
}
