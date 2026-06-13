import type { AuditSnapshotSource } from "./auditMessages"
import { hasAuditScoreRegression } from "./auditRegression"
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
	/** Act-mode advisory snapshots — SonarQube-style issue annotations during progress. */
	advisorySnapshotCount: number
	suppressedViolationCount: number
	/** Violations present in both earliest and latest snapshots — technical debt signal. */
	persistentViolationCount: number
	/** Score delta from previous snapshot to latest — mirrors SonarQube period-over-period. */
	latestScoreDelta: number | undefined
	/** Consecutive gate-block snapshots at tail — GitHub Checks failure streak. */
	trailingGateBlockStreak: number
	/** Latest completion regressed vs. plan audit baseline. */
	planRegressionDetected: boolean
	trend: "improving" | "degrading" | "stable" | "unknown"
}

export function computeAuditHealthSummary(
	snapshots: Array<{ auditMetadata: TaskAuditMetadata; source?: AuditSnapshotSource }>,
): AuditHealthSummary | undefined {
	if (snapshots.length === 0) {
		return undefined
	}

	let scoreSum = 0
	let scoredCount = 0
	let criticalViolationCount = 0
	let warningViolationCount = 0
	let gateBlockCount = 0
	let advisorySnapshotCount = 0
	let suppressedViolationCount = 0

	for (const { auditMetadata, source } of snapshots) {
		if (auditMetadata.gate_blocked) {
			gateBlockCount += 1
		}
		if (source === "advisory") {
			advisorySnapshotCount += 1
		}
		suppressedViolationCount += auditMetadata.suppressed_violations?.length ?? 0
		const hardeningScore = auditMetadata.hardening_score
		if (Number.isFinite(hardeningScore)) {
			scoreSum += hardeningScore
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
	const persistentViolationCount = getPersistentViolations(earliest, latest).length

	let latestScoreDelta: number | undefined
	if (snapshots.length > 1) {
		const previous = snapshots[snapshots.length - 2].auditMetadata
		const previousScore = previous.hardening_score
		if (Number.isFinite(latestScore) && Number.isFinite(previousScore)) {
			latestScoreDelta = latestScore - previousScore
		}
	}

	let trend: AuditHealthSummary["trend"] = "unknown"
	if (Number.isFinite(latestScore) && Number.isFinite(earliestScore) && snapshots.length > 1) {
		const delta = latestScore - earliestScore
		if (delta >= 5) trend = "improving"
		else if (delta <= -5) trend = "degrading"
		else trend = "stable"
	}

	let trailingGateBlockStreak = 0
	for (let i = snapshots.length - 1; i >= 0; i--) {
		if (!snapshots[i].auditMetadata.gate_blocked) break
		trailingGateBlockStreak += 1
	}

	return {
		snapshotCount: snapshots.length,
		averageScore: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : 0,
		latestGrade: latest.hardening_grade,
		criticalViolationCount,
		warningViolationCount,
		gateBlockCount,
		advisorySnapshotCount,
		suppressedViolationCount,
		persistentViolationCount,
		latestScoreDelta,
		trailingGateBlockStreak,
		planRegressionDetected: false,
		trend,
	}
}

/** Computes health summary with optional plan baseline for regression detection. */
export function computeAuditHealthSummaryWithBaseline(
	snapshots: Array<{ auditMetadata: TaskAuditMetadata; source?: AuditSnapshotSource }>,
	planBaselineMetadata?: TaskAuditMetadata,
): AuditHealthSummary | undefined {
	const summary = computeAuditHealthSummary(snapshots)
	if (!summary || !planBaselineMetadata || snapshots.length === 0) {
		return summary
	}
	const latest = snapshots[snapshots.length - 1].auditMetadata
	return {
		...summary,
		planRegressionDetected: hasAuditScoreRegression(planBaselineMetadata, latest),
	}
}

export function shouldEscalateFromAdvisory(advisory: TaskAuditMetadata | undefined, completion: TaskAuditMetadata): boolean {
	if (!advisory) return false
	if (!hasCriticalViolations(advisory.violations)) return false
	return hasUnresolvedAdvisoryFindings(advisory, completion)
}
