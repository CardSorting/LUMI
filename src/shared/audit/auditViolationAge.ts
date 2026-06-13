import type { AuditMessageSnapshot } from "./auditMessages"

/** Consecutive snapshots at tail where violation remains open — SonarQube issue age pattern. */
export function getTrailingViolationAge(snapshots: AuditMessageSnapshot[], violation: string): number {
	let age = 0
	for (let i = snapshots.length - 1; i >= 0; i--) {
		const violations = snapshots[i].auditMetadata.violations ?? []
		if (!violations.includes(violation)) {
			break
		}
		age += 1
	}
	return age
}

/** Maps violations to trailing snapshot age for history UI badges. */
export function computeTrailingViolationAges(snapshots: AuditMessageSnapshot[]): Map<string, number> {
	const ages = new Map<string, number>()
	const latest = snapshots[snapshots.length - 1]
	if (!latest?.auditMetadata.violations?.length) {
		return ages
	}
	for (const violation of latest.auditMetadata.violations) {
		const age = getTrailingViolationAge(snapshots, violation)
		if (age > 0) {
			ages.set(violation, age)
		}
	}
	return ages
}
