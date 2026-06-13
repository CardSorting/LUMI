import type { AuditMessageSnapshot } from "./auditMessages"
import type { AuditHealthSummary } from "./auditRollup"
import { computeAuditSnapshotDiff } from "./auditSnapshotDiff"
import { AUDIT_HEALTH_TREND_LABELS, AUDIT_SNAPSHOT_SOURCE_LABELS } from "./auditSnapshotLabels"
import { formatAuditTime, formatViolationLabel } from "./taskAuditUtils"

/** Stable key for audit snapshot selection — mirrors React list key best practice. */
export function getAuditSnapshotKey(snapshot: Pick<AuditMessageSnapshot, "ts" | "source">): string {
	return `${snapshot.ts}-${snapshot.source}`
}

export function clampAuditFocusIndex(index: number, count: number): number {
	if (count <= 0) return 0
	return Math.max(0, Math.min(count - 1, index))
}

/** Reconciles focus/selection when snapshot list changes — prevents stale UI state. */
export function reconcileAuditHistoryState(
	snapshots: AuditMessageSnapshot[],
	focusedIndex: number,
	selectedKey: string | null,
): { focusedIndex: number; selectedKey: string | null } {
	const keys = new Set(snapshots.map(getAuditSnapshotKey))
	const nextSelectedKey = selectedKey && keys.has(selectedKey) ? selectedKey : null
	const nextFocusedIndex = clampAuditFocusIndex(focusedIndex, snapshots.length)
	return { focusedIndex: nextFocusedIndex, selectedKey: nextSelectedKey }
}

export function buildAuditHistoryAnnouncement(snapshot: AuditMessageSnapshot, sourceLabel: string): string {
	const grade = snapshot.auditMetadata.hardening_grade ?? "unknown"
	const score = Number.isFinite(snapshot.auditMetadata.hardening_score)
		? ` score ${snapshot.auditMetadata.hardening_score}`
		: ""
	const gateNote = snapshot.auditMetadata.gate_blocked
		? " gate blocked"
		: snapshot.source === "advisory"
			? " act-mode advisory"
			: ""
	return `Selected ${sourceLabel} audit grade ${grade}${score}${gateNote}`
}

/** Extracts hardening scores for sparkline/timeline UI — Datadog-style metric strip. */
export function extractAuditScoreTimeline(snapshots: AuditMessageSnapshot[]): number[] {
	return snapshots
		.map((snapshot) => snapshot.auditMetadata.hardening_score)
		.filter((score): score is number => Number.isFinite(score))
}

/** Counts trailing gate-block snapshots — GitHub Checks failure streak pattern. */
export function countTrailingGateBlocks(snapshots: AuditMessageSnapshot[]): number {
	let streak = 0
	for (let i = snapshots.length - 1; i >= 0; i--) {
		if (!snapshots[i].auditMetadata.gate_blocked) break
		streak += 1
	}
	return streak
}

/** Auto-expand audit history when a new gate block or advisory arrives — reduces missed failure signals. */
export function shouldAutoExpandAuditHistory(snapshots: AuditMessageSnapshot[], previousSnapshotCount: number): boolean {
	if (snapshots.length <= previousSnapshotCount) return false
	const latest = snapshots[snapshots.length - 1]
	if (latest?.auditMetadata.gate_blocked === true) return true
	if (latest?.source === "advisory" && (latest.auditMetadata.violations?.length ?? 0) > 0) return true
	return false
}

/** Shows audit history when multiple snapshots exist or a single gate block needs visibility. */
export function shouldShowAuditHistoryStrip(snapshots: AuditMessageSnapshot[], health?: AuditHealthSummary): boolean {
	if (snapshots.length > 1) return true
	if (snapshots.length === 1 && snapshots[0].auditMetadata.gate_blocked) return true
	if (snapshots.length === 1 && snapshots[0].source === "advisory") return true
	if (health?.planRegressionDetected) return true
	return false
}

/** Markdown export for audit timeline — mirrors SonarQube project activity export. */
export function buildAuditHistoryMarkdown(snapshots: AuditMessageSnapshot[], health?: AuditHealthSummary): string {
	const lines = ["## Task Audit History", ""]
	if (health) {
		lines.push(
			`- Snapshots: ${health.snapshotCount}`,
			`- Average score: ${health.averageScore}`,
			`- Trend: ${AUDIT_HEALTH_TREND_LABELS[health.trend] || "unknown"}`,
		)
		if (health.gateBlockCount > 0) lines.push(`- Gate blocks: ${health.gateBlockCount}`)
		if (health.advisorySnapshotCount > 0) lines.push(`- Act-mode advisories: ${health.advisorySnapshotCount}`)
		if (health.trailingGateBlockStreak > 0) lines.push(`- Consecutive blocks: ${health.trailingGateBlockStreak}`)
		if (health.planRegressionDetected) lines.push("- Plan regression detected")
		if (health.persistentViolationCount > 0) lines.push(`- Persistent violations: ${health.persistentViolationCount}`)
		lines.push("")
	}

	for (let index = 0; index < snapshots.length; index++) {
		const snapshot = snapshots[index]
		const source = AUDIT_SNAPSHOT_SOURCE_LABELS[snapshot.source]
		const meta = snapshot.auditMetadata
		const grade = meta.hardening_grade ?? "?"
		const score = Number.isFinite(meta.hardening_score) ? `${meta.hardening_score}/100` : "N/A"
		const time = formatAuditTime(meta.audited_at ?? snapshot.ts)
		lines.push(`### ${source} · ${time}`)
		lines.push(`- Grade: ${grade} (${score})`)
		if (meta.gate_blocked) lines.push("- Status: **Gate blocked**")
		if (snapshot.source === "advisory") lines.push("- Status: Act-mode advisory")
		if ((meta.violations?.length ?? 0) > 0) {
			const violations = meta.violations ?? []
			lines.push(`- Violations: ${violations.map(formatViolationLabel).join(", ")}`)
		}
		const previous = index > 0 ? snapshots[index - 1].auditMetadata : undefined
		const diff = computeAuditSnapshotDiff(previous, meta)
		if (diff && (diff.newViolations.length > 0 || diff.resolvedViolations.length > 0)) {
			if (diff.scoreDelta !== undefined) lines.push(`- Score delta: ${diff.scoreDelta >= 0 ? "+" : ""}${diff.scoreDelta}`)
			if (diff.newViolations.length > 0) lines.push(`- New: ${diff.newViolations.map(formatViolationLabel).join(", ")}`)
			if (diff.resolvedViolations.length > 0) {
				lines.push(`- Resolved: ${diff.resolvedViolations.map(formatViolationLabel).join(", ")}`)
			}
		}
		lines.push("")
	}
	return lines.join("\n")
}
