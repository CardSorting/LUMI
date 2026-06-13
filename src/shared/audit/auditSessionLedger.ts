import type { AuditMessageSnapshot, AuditSnapshotSource } from "./auditMessages"
import { formatViolationLabel } from "./taskAuditUtils"

export type ViolationLedgerStatus = "open" | "resolved"

export interface ViolationLedgerEntry {
	violation: string
	firstSeenTs: number
	lastSeenTs: number
	snapshotCount: number
	status: ViolationLedgerStatus
	firstSeenSource: AuditSnapshotSource
}

/** SonarQube-style session issue ledger — tracks open/resolved violations across audit snapshots. */
export function buildViolationSessionLedger(snapshots: AuditMessageSnapshot[]): ViolationLedgerEntry[] {
	if (snapshots.length === 0) {
		return []
	}

	const entries = new Map<string, ViolationLedgerEntry>()
	const latestViolations = new Set(snapshots[snapshots.length - 1].auditMetadata.violations ?? [])

	for (const snapshot of snapshots) {
		for (const violation of snapshot.auditMetadata.violations ?? []) {
			const existing = entries.get(violation)
			if (existing) {
				existing.lastSeenTs = snapshot.ts
				existing.snapshotCount += 1
			} else {
				entries.set(violation, {
					violation,
					firstSeenTs: snapshot.ts,
					lastSeenTs: snapshot.ts,
					snapshotCount: 1,
					status: "open",
					firstSeenSource: snapshot.source,
				})
			}
		}
	}

	for (const entry of entries.values()) {
		entry.status = latestViolations.has(entry.violation) ? "open" : "resolved"
	}

	return [...entries.values()].sort((left, right) => {
		if (left.status !== right.status) {
			return left.status === "open" ? -1 : 1
		}
		return right.snapshotCount - left.snapshotCount
	})
}

export function countOpenViolationLedgerEntries(ledger: ViolationLedgerEntry[]): number {
	return ledger.filter((entry) => entry.status === "open").length
}

/** Auto-expand issue ledger when new open violations appear — SonarQube new-issue notification. */
export function shouldAutoExpandViolationLedger(snapshots: AuditMessageSnapshot[], previousOpenCount: number): boolean {
	const ledger = buildViolationSessionLedger(snapshots)
	return countOpenViolationLedgerEntries(ledger) > previousOpenCount
}

export function buildViolationSessionLedgerMarkdown(ledger: ViolationLedgerEntry[]): string {
	if (ledger.length === 0) {
		return ""
	}
	const open = ledger.filter((entry) => entry.status === "open")
	const resolved = ledger.filter((entry) => entry.status === "resolved")
	const lines = ["### Session Issue Ledger", ""]
	if (open.length > 0) {
		lines.push(`**Open (${open.length}):**`)
		for (const entry of open.slice(0, 8)) {
			lines.push(`- ${formatViolationLabel(entry.violation)} (seen in ${entry.snapshotCount} snapshot(s))`)
		}
		lines.push("")
	}
	if (resolved.length > 0) {
		lines.push(`**Resolved (${resolved.length}):**`)
		for (const entry of resolved.slice(0, 5)) {
			lines.push(`- ${formatViolationLabel(entry.violation)}`)
		}
	}
	return lines.join("\n")
}
