import type { AuditHealthSummary } from "./auditRollup"

/** One-line audit health digest for collapsed header chips and tooltips. */
export function buildAuditHealthChipLabel(health: AuditHealthSummary | undefined): string | undefined {
	if (!health) {
		return undefined
	}
	const parts: string[] = []
	if (health.trailingGateBlockStreak > 1) {
		parts.push(`${health.trailingGateBlockStreak}× blocked`)
	} else if (health.gateBlockCount > 0) {
		parts.push(`${health.gateBlockCount} gate block${health.gateBlockCount === 1 ? "" : "s"}`)
	}
	if (health.advisorySnapshotCount > 0) {
		parts.push(`${health.advisorySnapshotCount} advisory${health.advisorySnapshotCount === 1 ? "" : "ies"}`)
	}
	if (health.persistentViolationCount > 0) {
		parts.push(`${health.persistentViolationCount} persistent`)
	}
	if (health.planRegressionDetected) {
		parts.push("plan regression")
	}
	return parts.length > 0 ? parts.join(" · ") : undefined
}

/** Screen-reader friendly health summary — Datadog-style status line. */
export function buildAuditHealthAnnouncement(health: AuditHealthSummary | undefined): string {
	if (!health) {
		return ""
	}
	const chip = buildAuditHealthChipLabel(health)
	const trend =
		health.trend !== "unknown"
			? ` Trend ${health.trend}${health.averageScore > 0 ? `, average score ${health.averageScore}` : ""}.`
			: ""
	return chip ? `Task audit: ${chip}.${trend}` : ""
}
