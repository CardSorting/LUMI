/**
 * Lifecycle Projection Conflict Resolver
 *
 * There must be exactly one lifecycle authority:
 *
 *   CompletionLifecycleSnapshot → CompletionLifecycleDecisionEngine
 *     → CompletionLifecycleDecision → CompletionActionGuard
 *
 * Legacy gate state, continuity markers, phase labels, checklist status, and
 * old recovery nudges are historical/projection data only. They may never
 * override the canonical decision.
 *
 * This module is the single resolution point.  All lifecycle-facing UI and
 * backend render paths must call `resolveLifecycleProjection()` instead of
 * reading legacy state directly.
 */

import type { CanonicalLifecycleDecision } from "./canonicalLifecycleDecision"
import type { CanonicalCompletionPhase } from "./canonicalSnapshot"
import type { GateLifecycleDecision } from "./gateLifecycleDecision"
import type { GateLifecycleFreshness } from "./gateLifecycleMessages"

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Which authority produced a given projection.
 * Ordered by precedence — `canonical_spine` always wins.
 */
export type LifecycleProjectionSource = "canonical_spine" | "legacy_gate" | "continuity_marker" | "task_checklist" | "fallback"

/**
 * Normalized status vocabulary — the only labels the UI may render.
 * Legacy labels like "Engineering pending", "Verification pending" are
 * never emitted by the resolver.
 */
export type CanonicalStatusLabel =
	| "Ready to complete"
	| "Probe allowed"
	| "Ready for finalization"
	| "Workspace changes required"
	| "Blocked"
	| "Finalized"
	| "Failed — receipt available"

/**
 * The resolved lifecycle projection.
 * Every field is derived from either the canonical decision or an explicit
 * fallback — never from legacy labels when a canonical decision exists.
 */
export interface LifecycleProjection {
	/** Which authority produced this projection. */
	source: LifecycleProjectionSource
	/** Normalized status label for the UI — never a legacy label. */
	statusLabel: CanonicalStatusLabel
	/** Canonical phase for headline/subtitle rendering. */
	phase: CanonicalCompletionPhase
	/** The single next action the agent may execute, or null if none. */
	nextAction: string | null
	/** Actions the agent must NOT execute. */
	forbiddenActions: readonly string[]
	/** Operator-facing instruction (imperative, no prose interpretation). */
	instruction: string
	/** Freshness of the underlying gate snapshot. */
	freshness: GateLifecycleFreshness
	/** Continuity marker — historical evidence only, never drives labels. */
	continuityMarker?: string
	/**
	 * Whether the legacy gate snapshot may render as actionable guidance.
	 * False when a canonical decision exists OR checklist is complete OR
	 * the legacy snapshot is stale — in those cases legacy data is
	 * evidence/debug metadata only.
	 */
	isLegacyActionable: boolean
	/**
	 * The legacy GateLifecycleDecision, if one exists.
	 * Kept for backward compatibility / evidence inspection ONLY.
	 * Callers MUST NOT use this to override `statusLabel` or `nextAction`.
	 */
	legacyDecision?: GateLifecycleDecision
}

/** Input to the resolver — collected from whatever sources are available. */
export interface LifecycleProjectionInput {
	/** Canonical decision from the CompletionLifecycleDecisionEngine, if available. */
	canonicalDecision?: CanonicalLifecycleDecision
	/** Legacy gate lifecycle decision from message history, if available. */
	legacyDecision?: GateLifecycleDecision
	/** Freshness of the legacy gate snapshot. */
	freshness?: GateLifecycleFreshness
	/** Continuity marker from gate history. */
	continuityMarker?: string
	/**
	 * Whether task progress / checklist is complete (all steps done).
	 * When true, stale legacy snapshots are demoted to evidence-only —
	 * they may not render actionable lifecycle guidance.
	 */
	checklistComplete?: boolean
}

// ─── Canonical Phase Mapping ─────────────────────────────────────────────────

/**
 * Map a canonical decision kind to its canonical phase.
 * This is the ONLY mapping the UI should use when a canonical decision exists.
 */
function canonicalDecisionToPhase(decision: CanonicalLifecycleDecision): CanonicalCompletionPhase {
	switch (decision.kind) {
		case "allow_attempt":
			return "ready_for_completion"
		case "allow_probe":
			return "ready_for_completion"
		case "route_to_finalization":
			return "completing"
		case "soft_block":
			return "blocked"
		case "hard_block":
			return "failed_with_receipt"
	}
}

/**
 * Map a canonical decision kind to its normalized status label.
 * These are the ONLY status strings the UI may render.
 */
function canonicalDecisionToStatusLabel(decision: CanonicalLifecycleDecision): CanonicalStatusLabel {
	switch (decision.kind) {
		case "allow_attempt":
			return "Ready to complete"
		case "allow_probe":
			return "Probe allowed"
		case "route_to_finalization":
			return "Ready for finalization"
		case "soft_block":
			return "Workspace changes required"
		case "hard_block":
			return "Blocked"
	}
}

// ─── Projection from Canonical Decision ────────────────────────────────────────

/**
 * Project a lifecycle projection from a canonical decision.
 * This is the authoritative path — legacy state is ignored entirely.
 */
function projectFromCanonicalDecision(
	decision: CanonicalLifecycleDecision,
	input: LifecycleProjectionInput,
): LifecycleProjection {
	return {
		source: "canonical_spine",
		statusLabel: canonicalDecisionToStatusLabel(decision),
		phase: canonicalDecisionToPhase(decision),
		nextAction: decision.nextAllowedAction === "none" ? null : decision.nextAllowedAction,
		forbiddenActions: decision.forbiddenActions,
		instruction: decision.canonicalInstruction,
		freshness: "current",
		continuityMarker: input.continuityMarker,
		isLegacyActionable: false,
		legacyDecision: input.legacyDecision,
	}
}

// ─── Projection from Legacy State (Fallback) ─────────────────────────────────

/**
 * Project a lifecycle projection from legacy gate state.
 * This is the fallback path — only used when no canonical decision exists.
 */
function projectFromFallbackLegacyState(input: LifecycleProjectionInput): LifecycleProjection {
	const legacy = input.legacyDecision
	const freshness = input.freshness ?? "unknown"

	if (!legacy) {
		return {
			source: "fallback",
			statusLabel: "Ready to complete",
			phase: "evaluating",
			nextAction: null,
			forbiddenActions: [],
			instruction: "Awaiting lifecycle evaluation.",
			freshness,
			continuityMarker: input.continuityMarker,
			isLegacyActionable: false,
		}
	}

	// Legacy lifecycle state is evidence only. It must never supply current
	// instructions, allowed actions, or status labels to normal UI.
	return {
		source: "legacy_gate",
		statusLabel: "Ready to complete",
		phase: "evaluating",
		nextAction: null,
		forbiddenActions: [],
		instruction: "Awaiting canonical lifecycle evaluation.",
		freshness,
		continuityMarker: input.continuityMarker,
		isLegacyActionable: false,
		legacyDecision: legacy,
	}
}

// ─── The Resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a lifecycle projection from available inputs.
 *
 * Conflict policy:
 * - If a canonical decision exists, it is the single authority.
 *   Legacy lifecycle labels, continuity markers, checklist status, and old
 *   recovery nudges are ignored.
 * - If canonical decision says `route_to_finalization`, UI must show next
 *   action as `run_finalization`.
 * - If canonical decision says `allow_attempt`, UI may show
 *   `attempt_completion`.
 * - If canonical decision says `soft_block`, UI must show "workspace changes
 *   required" and must NOT show verification/finalization as pending work.
 * - If canonical decision says `hard_block`, UI must show "blocked" / "stop
 *   and report."
 * - If no canonical decision exists, legacy state remains evidence-only and
 *   cannot produce current guidance.
 */
export function resolveLifecycleProjection(input: LifecycleProjectionInput): LifecycleProjection {
	if (input.canonicalDecision) {
		return projectFromCanonicalDecision(input.canonicalDecision, input)
	}
	return projectFromFallbackLegacyState(input)
}

// ─── Convenience: Check if a legacy label should be suppressed ────────────────

/**
 * Legacy gate lifecycle labels are evidence-only and never render as current
 * user guidance.
 */
export function shouldRenderLegacyLabel(_canonicalDecisionExists: boolean): boolean {
	return false
}

/**
 * Legacy allowedActions never render as "Next:" guidance. Canonical
 * `nextAllowedAction` is the only next-step authority.
 */
export function shouldRenderLegacyNextAction(_canonicalDecisionExists: boolean): boolean {
	return false
}

/**
 * Whether a continuity marker should drive current lifecycle labels.
 * Always returns false — continuity markers are historical evidence only.
 */
export function shouldContinuityMarkerDriveLabel(): boolean {
	return false
}

/**
 * Whether checklist completion can infer lifecycle phase.
 * Always returns false — checklist status is task-step data, not lifecycle data.
 */
export function shouldChecklistDriveLifecycle(): boolean {
	return false
}
