/** Canonical completion/finalization lifecycle — modern-only model. */
export type GateLifecycleState =
	| "engineering_in_progress"
	| "engineering_verified"
	| "finalization_ready"
	| "finalization_running"
	| "finalization_completed"
	| "receipt_sealed"
	| "completed_without_retry_completion"
	| "completion_retry_locked"
	| "audit_gate_corrupt"

export type GateActiveLane = "completion" | "finalization" | "none"

export type GateAxisStatus = "pending" | "passed" | "failed" | "not_applicable" | "running"

export const TERMINAL_GATE_LIFECYCLE_STATES: ReadonlySet<GateLifecycleState> = new Set([
	"completed_without_retry_completion",
	"audit_gate_corrupt",
])

export const FINALIZATION_LANE_STATES: ReadonlySet<GateLifecycleState> = new Set([
	"engineering_verified",
	"finalization_ready",
	"finalization_running",
	"finalization_completed",
	"receipt_sealed",
	"completed_without_retry_completion",
	"completion_retry_locked",
])

export function isTerminalGateLifecycle(state: GateLifecycleState): boolean {
	return TERMINAL_GATE_LIFECYCLE_STATES.has(state)
}

export function isFinalizationLaneActive(state: GateLifecycleState): boolean {
	return FINALIZATION_LANE_STATES.has(state)
}
