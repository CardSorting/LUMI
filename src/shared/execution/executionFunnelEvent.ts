/**
 * The sole serializable execution authority shared by parent tasks, sibling
 * invocations, and governed subagent lanes.
 *
 * Each event is a complete immutable observation of one invocation. Consumers
 * must not infer execution state from handler messages or combine events from
 * different invocation IDs.
 */
export const EXECUTION_FUNNEL_SCHEMA_VERSION = 1 as const

export type ExecutionFunnelPhase =
	| "evaluating"
	| "authorized"
	| "executing"
	| "blocked"
	| "denied"
	| "cancelled"
	| "succeeded"
	| "failed"

export type ExecutionFunnelDecisionKind = "allow" | "block" | "deny" | "cancel" | "success" | "failure"

export type ExecutionFunnelReasonCode =
	| "authorized"
	| "unregistered_tool"
	| "prior_user_rejection"
	| "single_tool_budget_exhausted"
	| "duplicate_invocation"
	| "lane_tool_denied"
	| "plan_mode_restriction"
	| "stale_fencing_token"
	| "lane_collision"
	| "roadmap_write_denied"
	| "policy_denied"
	| "hook_cancelled"
	| "task_cancelled"
	| "user_denied"
	| "preparation_failed"
	| "operation_failed"
	| "operation_succeeded"

export interface ExecutionFunnelStage {
	stage: string
	result: "passed" | "failed" | "skipped" | "not_applicable"
	reason: string
	decisive: boolean
}

export interface ExecutionFunnelEvent {
	schemaVersion: typeof EXECUTION_FUNNEL_SCHEMA_VERSION
	taskId: string
	invocationId: string
	permitId?: string
	toolName: string
	lane: "parent" | "sibling" | "subagent"
	phase: ExecutionFunnelPhase
	kind: ExecutionFunnelDecisionKind
	reasonCode: ExecutionFunnelReasonCode
	terminal: boolean
	reason: string
	stages: ExecutionFunnelStage[]
	workspaceRevision: number
	evaluatedAt: number
	completedAt?: number
}

export function isTerminalExecutionFunnelEvent(
	event: ExecutionFunnelEvent | undefined,
): event is ExecutionFunnelEvent & { terminal: true } {
	return event?.terminal === true
}
