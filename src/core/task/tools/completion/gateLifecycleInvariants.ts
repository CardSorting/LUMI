import type { GateLifecycleState } from "@shared/completion/completionLifecycle"
import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import type { TaskConfig } from "../types/TaskConfig"

export class GateLifecycleInvariantError extends Error {
	constructor(
		message: string,
		readonly lifecycleState: GateLifecycleState = "audit_gate_corrupt",
	) {
		super(message)
		this.name = "GateLifecycleInvariantError"
	}
}

export function validateGateLifecycleDecision(decision: GateLifecycleDecision): void {
	const overlap = decision.allowedActions.filter((action) => decision.forbiddenActions.includes(action))
	if (overlap.length > 0) {
		throw new GateLifecycleInvariantError(`Forbidden actions listed as allowed: ${overlap.join(", ")}`)
	}

	if (
		(decision.lifecycleState === "completion_retry_locked" || decision.lifecycleState === "finalization_ready") &&
		decision.engineering === "passed" &&
		!decision.allowedActions.includes("run_finalization")
	) {
		throw new GateLifecycleInvariantError("Retry-locked verified engineering must allow run_finalization")
	}

	if (
		decision.lifecycleState === "completion_retry_locked" &&
		decision.engineering !== "passed" &&
		decision.allowedActions.includes("run_finalization")
	) {
		throw new GateLifecycleInvariantError("Retry-locked unverified engineering must not allow run_finalization")
	}

	if (isTerminalGateLifecycle(decision.lifecycleState) && decision.moreToolCallsUseful) {
		throw new GateLifecycleInvariantError("Terminal lifecycle must not require more tool calls")
	}

	if (
		decision.finalization === "passed" &&
		(!decision.finalizationEvidence || decision.finalizationEvidence.artifactPaths.length === 0)
	) {
		throw new GateLifecycleInvariantError("Finalization success requires artifact evidence")
	}

	if (
		decision.lifecycleState === "completed_without_retry_completion" &&
		decision.receiptEligible &&
		!decision.completionReceipt
	) {
		throw new GateLifecycleInvariantError("Completed session requires sealed receipt")
	}
}

function isTerminalGateLifecycle(state: GateLifecycleState): boolean {
	return state === "completed_without_retry_completion" || state === "audit_gate_corrupt"
}

export function assertEngineeringLatchConsistent(config: TaskConfig): void {
	if (config.taskState.engineeringVerifiedAt && config.taskState.completionLifecycleState === "engineering_in_progress") {
		throw new GateLifecycleInvariantError("engineeringVerifiedAt conflicts with engineering_in_progress")
	}
}
