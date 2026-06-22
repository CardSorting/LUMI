/**
 * [LAYER: CORE]
 * Typed JoyRide cache decisions — discriminated unions, no silent ambiguity.
 */

import type { DietCodeToolResponseContent } from "@shared/messages/content"
import type { JoyRideReasonCode } from "./JoyRideReasonCodes"
import type { JoyRideCacheKind } from "./types"

export type JoyRideDecisionType = "hit" | "miss" | "stale" | "rejected" | "disabled" | "diagnosticOnly" | "degraded"

export type JoyRideFallbackBehavior =
	| "reuseCachedValue"
	| "executeNormally"
	| "executeAndStoreDiagnosticOnly"
	| "executeAndStoreReusableIfSafe"
	| "rejectArtifact"
	| "markStaleAndExecute"
	| "flushAndExecute"
	| "doNotStore"
	| "disableActiveReuse"
	| "shutdownCleanup"

/** @deprecated Use JoyRideDecisionType */
export type JoyRideDecisionKind = JoyRideDecisionType

export interface JoyRideDecisionContext {
	reasonCode: JoyRideReasonCode
	reasonMessage: string
	operationType?: string
	cacheKind?: JoyRideCacheKind
	keySummary?: string
	scope?: string
	ownerTaskId?: string
	workspaceGeneration?: number
	approvalBoundaryId?: string
	diagnosticOnly: boolean
	proofSummary?: string
	reuseBlockReason?: string
	fallbackBehavior: JoyRideFallbackBehavior
	auditEventId: string
	entryAgeMs?: number
	ttlRemainingMs?: number
	degraded: boolean
	configExplanation?: string
}

export interface JoyRideHitDecision<T> extends JoyRideDecisionContext {
	type: "hit"
	canReuse: true
	value: T
}

export interface JoyRideMissDecision extends JoyRideDecisionContext {
	type: "miss"
	canReuse: false
}

export interface JoyRideStaleDecision<T> extends JoyRideDecisionContext {
	type: "stale"
	canReuse: false
	value?: T
}

export interface JoyRideRejectedDecision extends JoyRideDecisionContext {
	type: "rejected"
	canReuse: false
}

export interface JoyRideDisabledDecision extends JoyRideDecisionContext {
	type: "disabled"
	canReuse: false
}

export interface JoyRideDiagnosticOnlyDecision extends JoyRideDecisionContext {
	type: "diagnosticOnly"
	canReuse: false
	diagnosticOnly: true
}

export interface JoyRideDegradedDecision extends JoyRideDecisionContext {
	type: "degraded"
	canReuse: false
	degraded: true
}

export type JoyRideCacheDecision<T = unknown> =
	| JoyRideHitDecision<T>
	| JoyRideMissDecision
	| JoyRideStaleDecision<T>
	| JoyRideRejectedDecision
	| JoyRideDisabledDecision
	| JoyRideDiagnosticOnlyDecision
	| JoyRideDegradedDecision

export type JoyRideCommandLookupDecision = JoyRideCacheDecision<[boolean, DietCodeToolResponseContent]>
export type JoyRideSearchLookupDecision = JoyRideCacheDecision<string>

let decisionCounter = 0

export function nextJoyRideAuditEventId(): string {
	decisionCounter += 1
	return `joyride-decision-${Date.now()}-${decisionCounter}`
}

export function isJoyRideHitDecision<T>(decision: JoyRideCacheDecision<T>): decision is JoyRideHitDecision<T> {
	return decision.type === "hit" && decision.canReuse
}

type DecisionExtra<T> = Partial<
	Omit<JoyRideDecisionContext, "reasonCode" | "reasonMessage" | "diagnosticOnly" | "fallbackBehavior">
> & {
	value?: T
}

function baseContext(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	fallbackBehavior: JoyRideFallbackBehavior,
	diagnosticOnly: boolean,
	degraded: boolean,
	extra?: DecisionExtra<unknown>,
): JoyRideDecisionContext {
	return {
		reasonCode,
		reasonMessage,
		diagnosticOnly,
		fallbackBehavior,
		degraded,
		auditEventId: extra?.auditEventId ?? nextJoyRideAuditEventId(),
		operationType: extra?.operationType,
		cacheKind: extra?.cacheKind,
		keySummary: extra?.keySummary,
		scope: extra?.scope,
		ownerTaskId: extra?.ownerTaskId,
		workspaceGeneration: extra?.workspaceGeneration,
		approvalBoundaryId: extra?.approvalBoundaryId,
		proofSummary: extra?.proofSummary,
		reuseBlockReason: extra?.reuseBlockReason,
		entryAgeMs: extra?.entryAgeMs,
		ttlRemainingMs: extra?.ttlRemainingMs,
		configExplanation: extra?.configExplanation,
	}
}

export function hitDecision<T>(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	value: T,
	extra?: DecisionExtra<T>,
): JoyRideHitDecision<T> {
	return {
		type: "hit",
		canReuse: true,
		value,
		...baseContext(reasonCode, reasonMessage, "reuseCachedValue", false, extra?.degraded ?? false, extra),
	}
}

export function missDecision<T>(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	extra?: DecisionExtra<T>,
): JoyRideMissDecision {
	return {
		type: "miss",
		canReuse: false,
		...baseContext(reasonCode, reasonMessage, "executeNormally", false, extra?.degraded ?? false, extra),
	}
}

export function staleDecision<T>(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	extra?: DecisionExtra<T>,
): JoyRideStaleDecision<T> {
	return {
		type: "stale",
		canReuse: false,
		value: extra?.value,
		...baseContext(reasonCode, reasonMessage, "markStaleAndExecute", false, extra?.degraded ?? false, extra),
	}
}

export function rejectedDecision(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	extra?: DecisionExtra<unknown>,
): JoyRideRejectedDecision {
	return {
		type: "rejected",
		canReuse: false,
		...baseContext(reasonCode, reasonMessage, "rejectArtifact", false, extra?.degraded ?? false, extra),
	}
}

export function disabledDecision(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	extra?: DecisionExtra<unknown>,
): JoyRideDisabledDecision {
	return {
		type: "disabled",
		canReuse: false,
		...baseContext(reasonCode, reasonMessage, "doNotStore", false, extra?.degraded ?? false, extra),
	}
}

export function diagnosticOnlyDecision(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	extra?: DecisionExtra<unknown>,
): JoyRideDiagnosticOnlyDecision {
	return {
		...baseContext(reasonCode, reasonMessage, "executeAndStoreDiagnosticOnly", true, extra?.degraded ?? false, extra),
		type: "diagnosticOnly",
		canReuse: false,
		diagnosticOnly: true,
	}
}

export function degradedDecision(
	reasonCode: JoyRideReasonCode,
	reasonMessage: string,
	extra?: DecisionExtra<unknown>,
): JoyRideDegradedDecision {
	return {
		...baseContext(reasonCode, reasonMessage, "executeNormally", false, true, extra),
		type: "degraded",
		canReuse: false,
		degraded: true,
	}
}

export function explainDecision(decision: JoyRideCacheDecision): string {
	const parts = [
		`type=${decision.type}`,
		`canReuse=${decision.canReuse}`,
		`reason=${decision.reasonCode}`,
		`fallback=${decision.fallbackBehavior}`,
		decision.keySummary ? `key=${decision.keySummary}` : undefined,
		decision.proofSummary ? `proof=${decision.proofSummary}` : undefined,
		decision.reuseBlockReason ? `block=${decision.reuseBlockReason}` : undefined,
		decision.degraded ? "degraded=true" : undefined,
		decision.entryAgeMs !== undefined ? `ageMs=${decision.entryAgeMs}` : undefined,
	].filter(Boolean)
	return parts.join(" ")
}
