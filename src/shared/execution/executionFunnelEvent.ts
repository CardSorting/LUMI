/**
 * The sole serializable execution authority shared by parent tasks, sibling
 * invocations, and governed subagent lanes.
 *
 * Each event is a complete immutable observation of one invocation. Consumers
 * must not infer execution state from handler messages or combine events from
 * different invocation IDs.
 */
export const EXECUTION_FUNNEL_SCHEMA_VERSION = 2 as const

export type ExecutionAuditValue =
	| string
	| number
	| boolean
	| null
	| ExecutionAuditValue[]
	| { [key: string]: ExecutionAuditValue }

export type ApprovalCapability =
	| "workspace_read"
	| "workspace_write"
	| "command"
	| "browser"
	| "network"
	| "mcp"
	| "internal_state"
	| "subagent"

export interface ApprovalRequirement {
	capability: ApprovalCapability
	path?: string
	scope?: "workspace" | "external" | "mixed"
	risk: "low" | "elevated" | "high"
	requestedSideEffects: string[]
	autoApprovalEligible: boolean
}

/** Pure declaration supplied by an operation adapter. It never contains a decision. */
export interface ApprovalIntent {
	description: string
	normalizedArguments: { [key: string]: ExecutionAuditValue }
	requirements: ApprovalRequirement[]
	prompt: {
		type: string
		message: string
		notification?: string
	}
}

export interface RecordedApprovalIntent extends ApprovalIntent {
	intentId: string
	taskId: string
	taskGeneration: string
	invocationId: string
	toolName: string
	preparedAt: number
}

export interface ApprovalPolicyInputs {
	settingsVersion: number
	actions: {
		readFiles: boolean
		readFilesExternally: boolean
		editFiles: boolean
		editFilesExternally: boolean
		executeSafeCommands: boolean
		executeAllCommands: boolean
		useBrowser: boolean
		useMcp: boolean
	}
	trustedCommandMatched: boolean
	commandSafetyTiers: Array<"safe-readonly" | "verification" | "diagnostic-store-only" | "no-store">
	mcpToolSettingMatched: boolean
	automaticApprovalConsidered: boolean
	automaticApprovalAllowed: boolean
}

export interface ApprovalDecision {
	decisionId: string
	intentId: string
	taskId: string
	taskGeneration: string
	invocationId: string
	status: "approved" | "denied" | "cancelled" | "expired" | "failed"
	actor: "execution_policy" | "automatic_policy" | "user" | "cancellation" | "system"
	mechanism: "not_required" | "automatic" | "explicit" | "cancellation" | "preparation_failure"
	reason: string
	prompted: boolean
	decidedAt: number
}

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
	| "approval_preparation_failed"
	| "approval_denied"
	| "approval_cancelled"
	| "approval_expired"
	| "approval_failed"
	| "user_denied"
	| "preparation_failed"
	| "operation_failed"
	| "operation_succeeded"

export interface ExecutionFunnelStage {
	stage: string
	result: "passed" | "failed" | "skipped" | "not_applicable"
	reason: string
	decisive: boolean
	details?: ExecutionAuditValue
}

export interface ExecutionFunnelEvent {
	schemaVersion: typeof EXECUTION_FUNNEL_SCHEMA_VERSION
	taskId: string
	taskGeneration: string
	invocationId: string
	permitId?: string
	permitDecisionId?: string
	approvalIntent?: RecordedApprovalIntent
	approvalPolicyInputs?: ApprovalPolicyInputs
	approvalDecision?: ApprovalDecision
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
