/**
 * [LAYER: CORE]
 * Lightweight audit trail for JoyRide cache hits — answers "why did LUMI not rerun this?"
 */

import { Logger } from "@shared/services/Logger"
import type { JoyRideCacheKind } from "./types"

export interface JoyRideCacheHitAudit {
	timestamp: number
	key: string
	cacheKind: JoyRideCacheKind
	operationType: string
	ownerTaskId: string
	validationFingerprintSummary: string
	reuseReason: string
	entryAgeMs: number
	hitSource: "command" | "verification" | "grep" | "other"
	fallbackOnValidationFailure: "force_miss"
}

const MAX_AUDIT_ENTRIES = 128
const auditTrail: JoyRideCacheHitAudit[] = []

export function recordJoyRideCacheHit(audit: Omit<JoyRideCacheHitAudit, "timestamp" | "fallbackOnValidationFailure">): void {
	const entry: JoyRideCacheHitAudit = {
		...audit,
		timestamp: Date.now(),
		fallbackOnValidationFailure: "force_miss",
	}
	auditTrail.push(entry)
	if (auditTrail.length > MAX_AUDIT_ENTRIES) {
		auditTrail.splice(0, auditTrail.length - MAX_AUDIT_ENTRIES)
	}
	Logger.info(
		`[JoyRide] cache_hit key=${audit.key.slice(0, 48)} kind=${audit.cacheKind} op=${audit.operationType} task=${audit.ownerTaskId} ageMs=${audit.entryAgeMs} reason=${audit.reuseReason}`,
	)
}

export function getJoyRideCacheHitAuditTrail(limit = 32): readonly JoyRideCacheHitAudit[] {
	return auditTrail.slice(-limit)
}

export function clearJoyRideCacheHitAuditTrail(): void {
	auditTrail.length = 0
}

export function getJoyRideCacheHitAuditCount(): number {
	return auditTrail.length
}
