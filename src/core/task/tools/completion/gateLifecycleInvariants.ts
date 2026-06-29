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

	// Contradictory-state prevention — no overlapping contradictory phases
	// Rule: "passed" engineering must not coexist with "blocked" finalization on terminal states
	if (
		isTerminalGateLifecycle(decision.lifecycleState) &&
		decision.engineering === "passed" &&
		decision.finalization === "failed"
	) {
		throw new GateLifecycleInvariantError(
			"Terminal state with passed engineering but failed finalization — contradictory snapshot",
		)
	}

	// Rule: "receipt_sealed" must not coexist with pending axes
	if (decision.lifecycleState === "receipt_sealed" && (decision.documentation === "pending" || decision.ledger === "pending")) {
		throw new GateLifecycleInvariantError("Receipt sealed with pending documentation or ledger — contradictory snapshot")
	}

	// Rule: "finalization_running" must be in finalization lane
	if (decision.lifecycleState === "finalization_running" && decision.activeLane !== "finalization") {
		throw new GateLifecycleInvariantError("Finalization running outside finalization lane — contradictory snapshot")
	}

	// Rule: engineering_in_progress must not have passed finalization
	if (decision.lifecycleState === "engineering_in_progress" && decision.finalization === "passed") {
		throw new GateLifecycleInvariantError("Engineering in progress with passed finalization — contradictory snapshot")
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

/**
 * Assert that the completion snapshot has no contradictory states.
 * Mirrors canonical snapshot invariants — prevents "ready + stale", "safe + blocked", etc.
 */
export function assertNoContradictoryCompletionState(config: TaskConfig): void {
	const lifecycleState = config.taskState.completionLifecycleState
	const engineeringVerified = typeof config.taskState.engineeringVerifiedAt === "number"
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	const isRetryLocked = blockCount >= MAX_COMPLETION_GATE_BLOCK_COUNT_VALUE

	// Rule: verified engineering must not be in "engineering_in_progress"
	if (engineeringVerified && lifecycleState === "engineering_in_progress") {
		throw new GateLifecycleInvariantError(
			`Contradictory state: engineering verified but lifecycle is engineering_in_progress`,
		)
	}

	// Rule: retry-locked with verified engineering must not allow completion attempts
	if (isRetryLocked && engineeringVerified && lifecycleState === "engineering_in_progress") {
		throw new GateLifecycleInvariantError(
			`Contradictory state: retry-locked with verified engineering but in engineering_in_progress`,
		)
	}

	// Rule: sealed receipt must not coexist with active block count
	if (lifecycleState === "receipt_sealed" && blockCount > 0) {
		throw new GateLifecycleInvariantError(`Contradictory state: receipt sealed with non-zero block count (${blockCount})`)
	}
}

/** Local constant to avoid circular import — must match MAX_COMPLETION_GATE_BLOCK_COUNT in gatePolicy.ts */
const MAX_COMPLETION_GATE_BLOCK_COUNT_VALUE = 10
