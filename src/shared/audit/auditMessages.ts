import type { DietCodeMessage, TaskAuditMetadata } from "@shared/ExtensionMessage"
import { dedupeConsecutiveAdvisorySnapshots } from "./auditAdvisoryDedup"
import { computeHardeningAssessment } from "./taskAuditUtils"

export type AuditSnapshotSource = "completion" | "plan" | "gate_block" | "advisory"

/** Message types that carry architectural audit metadata. */
const AUDIT_BEARING_ASKS = new Set<DietCodeMessage["ask"]>(["plan_mode_respond", "completion_result"])
const AUDIT_BEARING_SAYS = new Set<DietCodeMessage["say"]>(["completion_result", "info", "plan_summary"])

export interface AuditMessageSnapshot {
	ts: number
	source: AuditSnapshotSource
	auditMetadata: TaskAuditMetadata
}

/** Info messages carrying act-mode advisory audit metadata (non-blocking). */
export function isAdvisoryAuditInfoMessage(message: DietCodeMessage): boolean {
	if (message.type !== "say" || message.say !== "info" || !message.auditMetadata) {
		return false
	}
	if (message.auditMetadata.gate_blocked) {
		return false
	}
	return (message.auditMetadata.violations?.length ?? 0) > 0 || message.auditMetadata.divergence_detected === true
}

export function messageCarriesAuditMetadata(message: DietCodeMessage): boolean {
	if (!message.auditMetadata) {
		return false
	}
	if (message.type === "say" && message.say === "info") {
		return message.auditMetadata.gate_blocked === true || isAdvisoryAuditInfoMessage(message)
	}
	if (message.type === "say" && message.say && AUDIT_BEARING_SAYS.has(message.say)) {
		return true
	}
	if (message.type === "ask" && message.ask && AUDIT_BEARING_ASKS.has(message.ask)) {
		return true
	}
	return false
}

/** Returns the most recent audit metadata from task chat history.
 * Scans newest-first — industry pattern for "latest quality gate result".
 */
export function getLatestAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (messageCarriesAuditMetadata(message) && message.auditMetadata) {
			return message.auditMetadata
		}
	}
	return undefined
}

/**
 * Returns audit metadata for completion gate UI — excludes act-mode advisories so
 * header badge/checklist reflect completion readiness (GitHub Checks head commit pattern).
 */
export function getLatestGateAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (!message.auditMetadata || !messageCarriesAuditMetadata(message)) {
			continue
		}
		if (resolveAuditSource(message) === "advisory") {
			continue
		}
		return message.auditMetadata
	}
	return undefined
}

/** Previous gate-relevant audit snapshot — pairs with getLatestGateAuditFromMessages for trend. */
export function getPreviousGateAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	let foundLatest = false
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (!message.auditMetadata || !messageCarriesAuditMetadata(message)) {
			continue
		}
		if (resolveAuditSource(message) === "advisory") {
			continue
		}
		if (foundLatest) {
			return message.auditMetadata
		}
		foundLatest = true
	}
	return undefined
}

/** Prior act-mode advisory before a message timestamp — SonarQube issue diff baseline. */
export function getPreviousAdvisoryAuditBeforeTs(messages: DietCodeMessage[], beforeTs: number): TaskAuditMetadata | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.ts >= beforeTs) {
			continue
		}
		if (isAdvisoryAuditInfoMessage(message) && message.auditMetadata) {
			return message.auditMetadata
		}
	}
	return undefined
}

/** Returns the most recent plan-mode audit snapshot for regression baselines. */
export function getLatestPlanAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.auditMetadata && message.type === "say" && message.say === "plan_summary") {
			return message.auditMetadata
		}
		if (message.type === "ask" && message.ask === "plan_mode_respond" && message.auditMetadata) {
			return message.auditMetadata
		}
	}
	return undefined
}

/** Returns the most recent act-mode advisory audit from chat history. */
export function getLatestAdvisoryAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (isAdvisoryAuditInfoMessage(message) && message.auditMetadata) {
			return message.auditMetadata
		}
	}
	return undefined
}

export function resolveAuditSource(message: DietCodeMessage): AuditSnapshotSource | undefined {
	if (message.type === "say" && message.say === "info") {
		if (message.auditMetadata?.gate_blocked) return "gate_block"
		if (isAdvisoryAuditInfoMessage(message)) return "advisory"
		return undefined
	}
	if (message.type === "say" && message.say === "completion_result") return "completion"
	if (message.type === "say" && message.say === "plan_summary") return "plan"
	if (message.type === "ask" && message.ask === "plan_mode_respond") return "plan"
	if (message.type === "ask" && message.ask === "completion_result") return "completion"
	return undefined
}

/** Returns audit snapshots paired with message timestamps for history UI. */
export function getAuditSnapshotsFromMessages(messages: DietCodeMessage[]): AuditMessageSnapshot[] {
	const snapshots: AuditMessageSnapshot[] = []
	for (const message of messages) {
		if (!messageCarriesAuditMetadata(message) || !message.auditMetadata) continue
		const source = resolveAuditSource(message)
		if (!source) continue
		snapshots.push({ ts: message.ts, source, auditMetadata: message.auditMetadata })
	}
	return snapshots
}

/** Returns deduplicated audit snapshots for UI — suppresses repeated act-mode advisories. */
export function getDisplayAuditSnapshotsFromMessages(messages: DietCodeMessage[]): AuditMessageSnapshot[] {
	return dedupeConsecutiveAdvisorySnapshots(getAuditSnapshotsFromMessages(messages))
}

/** Returns all audit snapshots in chronological order (oldest first). */
export function getAllAuditsFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata[] {
	const audits: TaskAuditMetadata[] = []
	for (const message of messages) {
		if (messageCarriesAuditMetadata(message) && message.auditMetadata) {
			audits.push(message.auditMetadata)
		}
	}
	return audits
}

/** Returns the audit snapshot immediately before the latest one. */
export function getPreviousAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	let foundLatest = false
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (messageCarriesAuditMetadata(message) && message.auditMetadata) {
			if (foundLatest) {
				return message.auditMetadata
			}
			foundLatest = true
		}
	}
	return undefined
}

export type AuditTrend = "improved" | "degraded" | "stable" | "unknown"

const AUDIT_TREND_DELTA = 5

function resolveAuditScore(metadata: TaskAuditMetadata): number {
	const score = metadata.hardening_score
	if (typeof score === "number" && Number.isFinite(score)) {
		return score
	}
	return computeHardeningAssessment(metadata).score
}

/** Compares two audit snapshots — mirrors CI trend badges (pass rate delta). */
export function getAuditTrend(previous: TaskAuditMetadata | undefined, current: TaskAuditMetadata | undefined): AuditTrend {
	if (!previous || !current) {
		return "unknown"
	}
	const prevScore = resolveAuditScore(previous)
	const currScore = resolveAuditScore(current)
	if (currScore >= prevScore + AUDIT_TREND_DELTA) {
		return "improved"
	}
	if (currScore <= prevScore - AUDIT_TREND_DELTA) {
		return "degraded"
	}
	return "stable"
}

export const AUDIT_TREND_LABELS: Record<AuditTrend, string> = {
	improved: "Improved",
	degraded: "Degraded",
	stable: "Stable",
	unknown: "",
}

export function getAuditSummaryLabel(metadata: TaskAuditMetadata): string {
	const grade = metadata.hardening_grade ?? "?"
	const score = Number.isFinite(metadata.hardening_score) ? `${metadata.hardening_score}/100` : "N/A"
	const violations = metadata.violations?.length ?? 0
	const suppressed = metadata.suppressed_violations?.length ?? 0
	const parts = [violations > 0 ? `Grade ${grade} (${score}) · ${violations} violation(s)` : `Grade ${grade} (${score})`]
	if (suppressed > 0) {
		parts.push(`${suppressed} waived`)
	}
	return parts.join(" · ")
}
