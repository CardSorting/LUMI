/**
 * CompletionActionGuard — the enforcement layer at the tool boundary.
 *
 * The decision engine determines truth. The action guard enforces truth.
 * The agent only executes the permitted next action.
 *
 * Responsibilities:
 * - Read the latest CompletionLifecycleDecision.
 * - Validate the requested tool/action against nextAllowedAction.
 * - Reject forbidden actions with a short canonical correction.
 * - Never let invalid agent actions mutate lifecycle counters.
 * - Never let invalid agent actions create new audit state.
 * - Never let invalid agent actions trigger duplicate retry loops.
 *
 * The agent does not interpret lifecycle state. It receives a command.
 * Every rejected action includes the current decision.kind, nextAllowedAction,
 * and one-line correction.
 *
 * Industry patterns mirrored:
 * - Capability-based security: the contract carries a capability token
 *   (nextAllowedAction) that the guard checks before execution.
 * - API gateway authorization: the gateway validates the request method
 *   against the route's allowed methods before forwarding.
 * - Rate limiter bypass: rejected requests don't consume the rate limit budget
 *   (forbidden actions don't increment circuit breaker counters).
 */

import { formatResponse } from "@core/prompts/responses"
import type { TaskConfig } from "../types/TaskConfig"
import type { ToolResponse } from "../types/ToolContracts"
import type { CompletionLifecycleDecision, CompletionNextAction } from "./CompletionLifecycleTypes"

/**
 * The tool name to CompletionNextAction mapping.
 * Maps the DietCodeDefaultTool enum values to the action contract namespace.
 */
const TOOL_TO_ACTION: ReadonlyMap<string, CompletionNextAction> = new Map([
	["attempt_completion", "attempt_completion"],
	["run_finalization", "run_finalization"],
])

/**
 * Result of a guard check.
 * - `allowed`: the action is permitted, proceed with execution.
 * - `rejected`: the action is forbidden, return the rejection response.
 */
export type GuardResult =
	| { allowed: true; decision: CompletionLifecycleDecision }
	| {
			allowed: false
			decision: CompletionLifecycleDecision
			rejection: ToolResponse
	  }

/**
 * Validate a requested tool action against the decision's binding action contract.
 *
 * This is the single enforcement point. All handlers must call this before
 * executing any tool logic. If the guard rejects, the handler returns the
 * rejection response immediately — no counter mutation, no audit state
 * creation, no retry loop.
 *
 * The guard is deterministic: the same lifecycle snapshot always produces
 * the same allowed action. Agent prose cannot override the engine decision.
 */
export function guardCompletionAction(requestedTool: string, decision: CompletionLifecycleDecision): GuardResult {
	const requestedAction = TOOL_TO_ACTION.get(requestedTool)

	// Unknown completion tools (not attempt_completion or run_finalization)
	// are not governed by the action guard — let the handler proceed.
	if (!requestedAction) {
		return { allowed: true, decision }
	}

	// Check if the action is explicitly forbidden
	if (decision.forbiddenActions.includes(requestedAction)) {
		return {
			allowed: false,
			decision,
			rejection: formatRejection(decision, requestedAction),
		}
	}

	// Check if the action matches the allowed next action
	if (decision.nextAllowedAction === requestedAction) {
		return { allowed: true, decision }
	}

	// The action is not forbidden but also not the next allowed action.
	// This happens when the decision says "modify_workspace" but the agent
	// calls attempt_completion — the action isn't explicitly forbidden
	// (it's in the forbidden list for soft_block/hard_block, so this path
	// is for edge cases like allow_probe + run_finalization).
	//
	// For soft_block and hard_block, attempt_completion IS in forbiddenActions,
	// so this path is only reached for decisions where the action isn't
	// explicitly listed. Treat as rejection with a correction.
	if (decision.nextAllowedAction !== "none") {
		return {
			allowed: false,
			decision,
			rejection: formatRejection(decision, requestedAction),
		}
	}

	return { allowed: true, decision }
}

/**
 * Format a canonical rejection response.
 *
 * Every rejected action includes:
 * - The current decision.kind
 * - The nextAllowedAction
 * - A one-line correction (canonicalInstruction)
 *
 * The response is a tool error that the agent receives as the tool result.
 * It does NOT increment any counters, create audit state, or trigger retries.
 */
function formatRejection(decision: CompletionLifecycleDecision, requestedAction: CompletionNextAction): ToolResponse {
	const correction =
		`Action "${requestedAction}" is not permitted. ` +
		`Decision: ${decision.kind}. ` +
		`Required next action: ${decision.nextAllowedAction}. ` +
		`${decision.canonicalInstruction}`

	return formatResponse.toolError(correction)
}

/**
 * Guard entry point for AttemptCompletionHandler.
 *
 * Evaluates the current lifecycle, checks the action contract, and returns
 * either an allow result (handler proceeds) or a rejection (handler returns
 * the rejection response immediately).
 *
 * This function NEVER mutates task state — rejected actions don't increment
 * counters, don't create audit state, and don't trigger retry loops.
 */
export function guardAttemptCompletion(_config: TaskConfig, decision: CompletionLifecycleDecision): GuardResult {
	return guardCompletionAction("attempt_completion", decision)
}

/**
 * Guard entry point for RunFinalizationToolHandler.
 *
 * Evaluates the current lifecycle, checks the action contract, and returns
 * either an allow result (handler proceeds) or a rejection (handler returns
 * the rejection response immediately).
 */
export function guardRunFinalization(_config: TaskConfig, decision: CompletionLifecycleDecision): GuardResult {
	return guardCompletionAction("run_finalization", decision)
}
