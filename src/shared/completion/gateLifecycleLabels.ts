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

export function assertExhaustiveGateLifecycleState(state: never): never {
	throw new Error(`Unhandled gate lifecycle state: ${String(state)}`)
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
