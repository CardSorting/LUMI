import type { CanonicalCompletionPhase } from "./canonicalSnapshot"
import type { GateLifecycleState } from "./completionLifecycle"

/** Canonical ordered list — used for exhaustiveness checks in tests. */
export const ALL_GATE_LIFECYCLE_STATES: readonly GateLifecycleState[] = [
	"engineering_in_progress",
	"engineering_verified",
	"finalization_ready",
	"finalization_running",
	"finalization_completed",
	"receipt_sealed",
	"completed_without_retry_completion",
	"completion_retry_locked",
	"audit_gate_corrupt",
] as const

/** Canonical completion phases — the seven operator-facing lifecycle states. */
export const ALL_CANONICAL_PHASES: readonly CanonicalCompletionPhase[] = [
	"evaluating",
	"synchronizing",
	"blocked",
	"ready_for_completion",
	"completing",
	"finalized",
	"failed_with_receipt",
] as const

export function assertExhaustiveGateLifecycleState(state: never): never {
	throw new Error(`Unhandled gate lifecycle state: ${String(state)}`)
}

export function assertExhaustiveCanonicalPhase(phase: never): never {
	throw new Error(`Unhandled canonical completion phase: ${String(phase)}`)
}

/** Operator-facing headline for each lifecycle state. */
export function getGateLifecycleHeadline(state: GateLifecycleState): string {
	switch (state) {
		case "engineering_in_progress":
			return "Engineering In Progress"
		case "engineering_verified":
			return "Engineering Verified"
		case "finalization_ready":
			return "Finalization Ready"
		case "finalization_running":
			return "Finalization Running"
		case "finalization_completed":
			return "Finalization Completed"
		case "receipt_sealed":
			return "Receipt Sealed"
		case "completed_without_retry_completion":
			return "Receipt Sealed"
		case "completion_retry_locked":
			return "Retry Locked — Recoverable"
		case "audit_gate_corrupt":
			return "Gate Corrupt"
		default:
			return assertExhaustiveGateLifecycleState(state)
	}
}

/**
 * Operator-facing headline for each canonical completion phase.
 * These are the calm, deterministic, enterprise-grade labels that replace
 * the old infrastructure-diagnostics wording.
 */
export function getCanonicalPhaseHeadline(phase: CanonicalCompletionPhase): string {
	switch (phase) {
		case "evaluating":
			return "Evaluating"
		case "synchronizing":
			return "Synchronizing"
		case "blocked":
			return "Blocked"
		case "ready_for_completion":
			return "Ready for Completion"
		case "completing":
			return "Completing"
		case "finalized":
			return "Finalized"
		case "failed_with_receipt":
			return "Failed — Receipt Available"
		default:
			return assertExhaustiveCanonicalPhase(phase)
	}
}

/**
 * Subtitle for each canonical phase — answers "what is happening right now?"
 * Designed to be concise and execution-native, not self-referential.
 */
export function getCanonicalPhaseSubtitle(phase: CanonicalCompletionPhase): string {
	switch (phase) {
		case "evaluating":
			return "Assessing engineering readiness and gate conditions."
		case "synchronizing":
			return "Reconciling execution state."
		case "blocked":
			return "A specific blocker must be resolved before completion can proceed."
		case "ready_for_completion":
			return "All gates passed — completion is eligible."
		case "completing":
			return "Finalizing documentation and sealing receipt."
		case "finalized":
			return "Session complete — receipt sealed."
		case "failed_with_receipt":
			return "Gate evaluation failed — diagnostic receipt available."
		default:
			return assertExhaustiveCanonicalPhase(phase)
	}
}

/** Tone class for headline badge — retry-lock is amber, not red. */
export function getGateLifecycleHeadlineTone(state: GateLifecycleState): "neutral" | "success" | "warning" | "danger" {
	switch (state) {
		case "engineering_in_progress":
		case "finalization_running":
			return "neutral"
		case "engineering_verified":
		case "finalization_ready":
		case "finalization_completed":
		case "receipt_sealed":
		case "completed_without_retry_completion":
			return "success"
		case "completion_retry_locked":
			return "warning"
		case "audit_gate_corrupt":
			return "danger"
		default:
			return assertExhaustiveGateLifecycleState(state)
	}
}

/**
 * Tone class for canonical phase badge — mirrors CI/CD pipeline status colors.
 * Evaluating/synchronizing are neutral; ready/completing/finalized are success;
 * blocked is warning; failed_with_receipt is danger.
 */
export function getCanonicalPhaseTone(phase: CanonicalCompletionPhase): "neutral" | "success" | "warning" | "danger" {
	switch (phase) {
		case "evaluating":
		case "synchronizing":
			return "neutral"
		case "ready_for_completion":
		case "completing":
		case "finalized":
			return "success"
		case "blocked":
			return "warning"
		case "failed_with_receipt":
			return "danger"
		default:
			return assertExhaustiveCanonicalPhase(phase)
	}
}
