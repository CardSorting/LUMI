import { shouldEmitAdvisoryAuditEvent } from "./completionAudit"
import type { TaskAuditMetadata } from "./types"

function normalizeViolationSet(violations: string[] | undefined): string[] {
	return [...(violations ?? [])].sort()
}

/** True when advisory findings match a prior snapshot — SonarQube duplicate-issue suppression. */
export function isDuplicateAdvisoryAudit(current: TaskAuditMetadata, previous: TaskAuditMetadata | undefined): boolean {
	if (!previous) {
		return false
	}
	if (current.divergence_detected !== previous.divergence_detected) {
		return false
	}
	const currentSet = normalizeViolationSet(current.violations)
	const previousSet = normalizeViolationSet(previous.violations)
	if (currentSet.length !== previousSet.length) {
		return false
	}
	return currentSet.every((violation, index) => violation === previousSet[index])
}

/** Violations newly introduced since the last advisory audit. */
export function getNewAdvisoryViolations(current: TaskAuditMetadata, previous: TaskAuditMetadata | undefined): string[] {
	const previousSet = new Set(previous?.violations ?? [])
	return (current.violations ?? []).filter((violation) => !previousSet.has(violation))
}

/** Whether to persist an act-mode advisory info message to chat — skips unchanged repeat findings. */
export function shouldEmitAdvisoryAuditChatEvent(current: TaskAuditMetadata, previous: TaskAuditMetadata | undefined): boolean {
	if (!shouldEmitAdvisoryAuditEvent(current)) {
		return false
	}
	return !isDuplicateAdvisoryAudit(current, previous)
}
