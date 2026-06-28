import type { LaneExecutionMode } from "./governedExecution"

/** Explicit lane lifecycle states — avoids ambiguous "blocked". */
export type LaneRuntimeState =
	| "pending"
	| "running"
	| "waiting"
	| "partial"
	| "soft_blocked"
	| "hard_blocked"
	| "sealing"
	| "complete"
	| "degraded_complete"

export type SubagentEntryStatus = "pending" | "running" | "completed" | "failed"

export function isOptionalAdvisoryLane(mode: LaneExecutionMode): boolean {
	return mode === "read_only" || mode === "audit_only" || mode === "diagnostic_only" || mode === "planning_only"
}

export function mapEntryStatusToLaneState(options: {
	entryStatus: SubagentEntryStatus
	hasPartialResult?: boolean
	hasHardError?: boolean
	hasAdvisoryWarnings?: boolean
	waitingOnDependency?: boolean
	sealing?: boolean
	degraded?: boolean
}): LaneRuntimeState {
	if (options.sealing) {
		return "sealing"
	}
	if (options.degraded && options.entryStatus === "completed") {
		return "degraded_complete"
	}
	if (options.entryStatus === "completed") {
		return "complete"
	}
	if (options.entryStatus === "failed" || options.hasHardError) {
		return "hard_blocked"
	}
	if (options.waitingOnDependency) {
		return "waiting"
	}
	if (options.hasPartialResult && options.entryStatus === "running") {
		return "partial"
	}
	if (options.hasAdvisoryWarnings && options.entryStatus === "running") {
		return "partial"
	}
	if (options.entryStatus === "running") {
		return "running"
	}
	return "pending"
}

/** Soft-blocked lanes may retry; hard-blocked lanes stop the lane DAG branch. */
export function laneStateAllowsSwarmContinuation(state: LaneRuntimeState, mode: LaneExecutionMode): boolean {
	if (state === "hard_blocked") {
		return false
	}
	if (state === "soft_blocked" || state === "degraded_complete") {
		return isOptionalAdvisoryLane(mode)
	}
	return true
}

export function laneStateShouldDegradeOnTimeout(mode: LaneExecutionMode): boolean {
	return isOptionalAdvisoryLane(mode)
}
