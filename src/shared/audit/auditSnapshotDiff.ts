import { formatViolationLabel } from "./taskAuditUtils"
import type { TaskAuditMetadata } from "./types"

export interface AuditSnapshotDiff {
	newViolations: string[]
	resolvedViolations: string[]
	persistentViolations: string[]
	scoreDelta: number | undefined
}

/** Compares two audit snapshots — mirrors SonarQube new-vs-fixed issue diff. */
export function computeAuditSnapshotDiff(
	baseline: TaskAuditMetadata | undefined,
	current: TaskAuditMetadata | undefined,
): AuditSnapshotDiff | undefined {
	if (!baseline || !current) {
		return undefined
	}

	const baselineSet = new Set(baseline.violations ?? [])
	const currentSet = new Set(current.violations ?? [])
	const newViolations = [...currentSet].filter((v) => !baselineSet.has(v))
	const resolvedViolations = [...baselineSet].filter((v) => !currentSet.has(v))
	const persistentViolations = [...baselineSet].filter((v) => currentSet.has(v))

	let scoreDelta: number | undefined
	if (Number.isFinite(baseline.hardening_score) && Number.isFinite(current.hardening_score)) {
		scoreDelta = current.hardening_score! - baseline.hardening_score!
	}

	return { newViolations, resolvedViolations, persistentViolations, scoreDelta }
}

export function buildAuditSnapshotDiffMarkdown(diff: AuditSnapshotDiff): string {
	const lines = ["### Audit Snapshot Diff", ""]

	if (diff.scoreDelta !== undefined) {
		const sign = diff.scoreDelta >= 0 ? "+" : ""
		lines.push(`- **Score delta:** ${sign}${diff.scoreDelta}`)
	}

	if (diff.newViolations.length > 0) {
		lines.push(
			`- **New violations (${diff.newViolations.length}):** ${diff.newViolations.map(formatViolationLabel).join(", ")}`,
		)
	}
	if (diff.resolvedViolations.length > 0) {
		lines.push(
			`- **Resolved (${diff.resolvedViolations.length}):** ${diff.resolvedViolations.map(formatViolationLabel).join(", ")}`,
		)
	}
	if (diff.persistentViolations.length > 0) {
		lines.push(
			`- **Persistent (${diff.persistentViolations.length}):** ${diff.persistentViolations.map(formatViolationLabel).join(", ")}`,
		)
	}

	if (diff.newViolations.length === 0 && diff.resolvedViolations.length === 0 && diff.persistentViolations.length === 0) {
		lines.push("- No violation changes")
	}

	return lines.join("\n")
}
