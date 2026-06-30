/**
 * Canonical Completion Snapshot — unified lifecycle model.
 *
 * All completion-critical subsystems (gate readiness, walkthrough, freshness,
 * audit validity, breather, finalization eligibility) derive from this single
 * authoritative snapshot.  No subsystem may carry independent stale clocks or
 * competing readiness derivations.
 *
 * @see completionLifecycle.ts for the underlying GateLifecycleState type.
 */

import type { GateLifecycleState } from "./completionLifecycle"
import type { GateLifecycleDecision } from "./gateLifecycleDecision"
import type { GateLifecycleFreshness } from "./gateLifecycleMessages"

/** The seven canonical phases every completion UI and orchestration path must use. */
export type CanonicalCompletionPhase =
	| "evaluating"
	| "synchronizing"
	| "blocked"
	| "ready_for_completion"
	| "completing"
	| "finalized"
	| "failed_with_receipt"

/** Audit validity — atomically tied to the canonical snapshot revision. */
export type AuditValidity = "valid" | "invalidated" | "stale_pending_reconciliation" | "not_evaluated"

/** Breather status — controlled reconciliation lane, not an escape hatch. */
export type BreatherStatus = "inactive" | "reconciling" | "completed" | "terminated"

/**
 * Unified snapshot — all completion-critical state in one place.
 * Mirrors a CI/CD pipeline status object: every field derives from the same
 * graph revision, so contradictory combinations are structurally impossible.
 */
export interface CanonicalCompletionSnapshot {
	/** Canonical phase — the single source of truth for UI rendering. */
	phase: CanonicalCompletionPhase
	/** Underlying gate lifecycle state (kept for backward compatibility). */
	lifecycleState: GateLifecycleState
	/** Gate lifecycle decision from the evaluator. */
	decision: GateLifecycleDecision
	/** Freshness of the last gate evaluation. */
	freshness: GateLifecycleFreshness
	/** Audit validity — invalidated when snapshot changes. */
	auditValidity: AuditValidity
	/** Breather reconciliation status. */
	breatherStatus: BreatherStatus
	/** Whether completion can proceed right now. */
	completionEligible: boolean
	/** The specific blocker if completion cannot proceed. */
	blockingCondition?: string
	/** Graph revision — incremented on every meaningful state transition. */
	graphRevision: number
	/** Timestamp of this snapshot. */
	evaluatedAt: number
}

/** Reconciliation debounce window — suppresses no-op retries within this period.
 * Tuned short: just enough to prevent retry thrashing, not long enough to make
 * valid completion feel blocked.  The graph-revision check is the real guard —
 * if meaningful state changed, the debounce is bypassed entirely. */
export const RECONCILIATION_DEBOUNCE_MS = 600

/** Freshness debounce window — gates must stabilize for this long before "ready".
 * Short: stale UI labels should clear the moment freshness is restored, not after
 * a perceptible delay. */
export const FRESHNESS_DEBOUNCE_MS = 200

/**
 * Map a GateLifecycleState to its canonical phase.
 * This is the only mapping function — all UI and orchestration must use it.
 *
 * Design: `synchronizing` is deliberately short-lived and transitional.
 * It only appears for `completion_retry_locked` with verified engineering
 * that hasn't yet entered the finalization lane.  Once finalization is
 * ready or running, the phase progresses directly to `ready_for_completion`
 * or `completing` — no intermediate `synchronizing` churn.
 */
export function mapLifecycleToCanonicalPhase(
	state: GateLifecycleState,
	decision?: GateLifecycleDecision,
): CanonicalCompletionPhase {
	// Terminal states — direct mapping, no transitional phase
	if (state === "completed_without_retry_completion") return "finalized"
	if (state === "audit_gate_corrupt") return "failed_with_receipt"

	// Retry-locked: only `synchronizing` if engineering is verified but
	// finalization lane hasn't started yet.  This is the single transitional use.
	if (state === "completion_retry_locked") {
		if (decision?.engineering === "passed") {
			// If finalization evidence already passed, skip straight to finalized
			return decision.finalization === "passed" ? "finalized" : "completing"
		}
		return "blocked"
	}

	// Finalization lane states — direct progression, no intermediate churn
	if (state === "receipt_sealed") return "finalized"
	if (state === "finalization_completed") return "finalized"
	if (state === "finalization_running") return "completing"
	if (state === "finalization_ready") return "completing"
	if (state === "engineering_verified") return "completing"

	// Default — still working
	return "evaluating"
}

/**
 * Validate that a snapshot has no contradictory states.
 * Throws if any invariant is violated — mirrors CI invariant checks.
 */
export function validateCanonicalSnapshot(snapshot: CanonicalCompletionSnapshot): void {
	const { phase, freshness, auditValidity, completionEligible, decision } = snapshot

	// Rule: "ready_for_completion" cannot coexist with stale/unknown freshness
	if (phase === "ready_for_completion" && freshness === "stale") {
		throw new Error(
			`Canonical invariant violation: ready_for_completion with stale freshness (graphRevision=${snapshot.graphRevision})`,
		)
	}

	// Rule: "ready_for_completion" requires valid audit
	if (phase === "ready_for_completion" && auditValidity === "invalidated") {
		throw new Error(
			`Canonical invariant violation: ready_for_completion with invalidated audit (graphRevision=${snapshot.graphRevision})`,
		)
	}

	// Rule: "finalized" requires receipt eligibility
	if (phase === "finalized" && !decision.receiptEligible) {
		throw new Error(
			`Canonical invariant violation: finalized without receipt eligibility (graphRevision=${snapshot.graphRevision})`,
		)
	}

	// Rule: "blocked" must not be completion-eligible
	if (phase === "blocked" && completionEligible) {
		throw new Error(
			`Canonical invariant violation: blocked phase with completionEligible=true (graphRevision=${snapshot.graphRevision})`,
		)
	}

	// Rule: "failed_with_receipt" must have terminal lifecycle
	if (phase === "failed_with_receipt" && decision.moreToolCallsUseful) {
		throw new Error(
			`Canonical invariant violation: failed_with_receipt with moreToolCallsUseful=true (graphRevision=${snapshot.graphRevision})`,
		)
	}

	// Rule: "completing" must be in finalization lane
	if (phase === "completing" && decision.activeLane !== "finalization") {
		throw new Error(
			`Canonical invariant violation: completing phase outside finalization lane (graphRevision=${snapshot.graphRevision})`,
		)
	}
}

/**
 * Derive audit validity from the current state.
 * If the snapshot changed (checkpoint hash differs), the audit is invalidated.
 *
 * Graph revision awareness: if provided, a mismatched graph revision also
 * invalidates the audit — the audit is only authoritative for the revision
 * it was computed at.  This prevents false-positive "valid" classifications
 * when the cache key matches but meaningful state transitions occurred.
 */
export function deriveAuditValidity(
	lastAuditCacheKey: string | undefined,
	currentCacheKey: string | undefined,
	lastAuditCachedAt: number | undefined,
	now = Date.now(),
	ttlMs = 5 * 60 * 1000,
	graphRevisionMatch?: boolean,
): AuditValidity {
	if (!lastAuditCacheKey || !lastAuditCachedAt) {
		return "not_evaluated"
	}
	if (currentCacheKey && lastAuditCacheKey !== currentCacheKey) {
		return "invalidated"
	}
	// Graph revision mismatch — workspace state changed since audit was computed
	if (graphRevisionMatch === false) {
		return "invalidated"
	}
	if (now - lastAuditCachedAt > ttlMs) {
		return "stale_pending_reconciliation"
	}
	return "valid"
}

/**
 * Derive the breather status from task state.
 * The breather is a controlled reconciliation lane — it either reconciles
 * and returns to ready, or terminates cleanly with a diagnostic.
 *
 * Design: once cooldown expires, the breather is immediately `inactive` —
 * no lingering `completed` state that creates stale synchronization UI.
 * The system clears reconciliation indicators aggressively when readiness
 * is already known.
 *
 * Fast-exit: if engineering is already verified (readiness is valid),
 * exit the breather immediately regardless of cooldown remaining.
 * Do not wait out the full breather duration when the system is ready.
 */
export function deriveBreatherStatus(
	lastBlockReason: string | undefined,
	blockCount: number,
	cooldownRemainingMs: number,
	engineeringVerified = false,
): BreatherStatus {
	if (blockCount === 0 || !lastBlockReason) {
		return "inactive"
	}
	// Fast-exit: readiness is valid — no reason to hold the breather
	if (engineeringVerified) {
		return "inactive"
	}
	if (cooldownRemainingMs > 0) {
		return "reconciling"
	}
	// Cooldown expired — immediately inactive, no lingering "completed" state
	return "inactive"
}

/**
 * Check whether a completion attempt is within the reconciliation debounce window.
 * Prevents no-op retry thrashing — if no meaningful state changed, suppress.
 */
export function isWithinReconciliationDebounce(
	lastAttemptAt: number | undefined,
	lastGraphRevision: number | undefined,
	currentGraphRevision: number,
	now = Date.now(),
	debounceMs = RECONCILIATION_DEBOUNCE_MS,
	engineeringVerified = false,
): boolean {
	if (engineeringVerified) {
		return false
	}
	if (!lastAttemptAt) {
		return false
	}
	// If graph revision changed, meaningful state changed — allow
	if (lastGraphRevision !== undefined && lastGraphRevision !== currentGraphRevision) {
		return false
	}
	// Same graph revision within debounce window — suppress
	return now - lastAttemptAt < debounceMs
}

/**
 * Build the blocking condition message for a snapshot.
 * Returns undefined if no blocker exists.
 *
 * Design: messages are execution-native and decisive — they explain
 * what needs to happen next, not what the system is doing internally.
 *
 * Fast-clearing: once freshness is restored to `current` and the audit is
 * `valid` (not invalidated), all reconciliation/synchronizing labels are
 * suppressed immediately.  No lingering "refreshing" states after readiness
 * is known.
 */
export function resolveBlockingCondition(snapshot: CanonicalCompletionSnapshot): string | undefined {
	if (snapshot.completionEligible) {
		return undefined
	}
	// Fast-clear: freshness is current and audit is not invalidated —
	// any breather/reconciliation labels are stale and should not show.
	const freshnessRestored = snapshot.freshness === "current" && snapshot.auditValidity !== "invalidated"
	if (freshnessRestored && snapshot.breatherStatus === "reconciling") {
		// Skip breather label — readiness is already known
	} else if (snapshot.breatherStatus === "reconciling") {
		return "Awaiting reconciliation completion — execution state is being refreshed."
	}
	if (snapshot.auditValidity === "invalidated") {
		return "Execution state changed — refreshing completion readiness."
	}
	// stale_pending_reconciliation only applies when freshness is NOT current —
	// don't show "refreshing audit" if the snapshot is already fresh.
	if (snapshot.auditValidity === "stale_pending_reconciliation" && snapshot.freshness !== "current") {
		return "Refreshing audit evaluation — reconciling latest evidence."
	}
	if (snapshot.freshness === "stale") {
		return "Refreshing orchestration state — validating completion readiness."
	}
	if (snapshot.freshness === "unknown") {
		return "Initializing completion readiness — no prior gate evaluation found."
	}
	if (snapshot.decision.forbiddenActions.includes("attempt_completion")) {
		return snapshot.decision.operatorMessage
	}
	return undefined
}
