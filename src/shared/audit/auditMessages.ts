import type { DietCodeMessage, TaskAuditMetadata } from "@shared/ExtensionMessage"
import { computeHardeningAssessment } from "./taskAuditUtils"

export type AuditSnapshotSource = "completion" | "plan" | "gate_block"

/** Message types that carry architectural audit metadata. */
const AUDIT_BEARING_ASKS = new Set<DietCodeMessage["ask"]>(["plan_mode_respond", "completion_result"])
const AUDIT_BEARING_SAYS = new Set<DietCodeMessage["say"]>(["completion_result", "info"])

export interface AuditMessageSnapshot {
	ts: number
	source: AuditSnapshotSource
	auditMetadata: TaskAuditMetadata
}

export function messageCarriesAuditMetadata(message: DietCodeMessage): boolean {
	if (!message.auditMetadata) {
		return false
	}
	if (message.type === "say" && message.say === "info" && !message.auditMetadata.gate_blocked) {
		return false
	}
	if (message.type === "say" && message.say && AUDIT_BEARING_SAYS.has(message.say)) {
		return true
	}
	if (message.type === "ask" && message.ask && AUDIT_BEARING_ASKS.has(message.ask)) {
		return true
	}
	return false
}

/**
 * Returns the most recent audit metadata from task chat history.
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

/** Returns the most recent plan-mode audit snapshot for regression baselines. */
export function getLatestPlanAuditFromMessages(messages: DietCodeMessage[]): TaskAuditMetadata | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.type === "ask" && message.ask === "plan_mode_respond" && message.auditMetadata) {
			return message.auditMetadata
		}
	}
	return undefined
}

export function resolveAuditSource(message: DietCodeMessage): AuditSnapshotSource | undefined {
	if (message.type === "say" && message.say === "info" && message.auditMetadata?.gate_blocked) return "gate_block"
	if (message.type === "say" && message.say === "completion_result") return "completion"
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
	if (Number.isFinite(metadata.hardening_score)) {
		return metadata.hardening_score!
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
