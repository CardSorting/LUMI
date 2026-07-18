/**
 * The sole serializable completion authority shared by the core and webview.
 *
 * Every publish is a complete, immutable observation of the funnel at one
 * graph revision. Consumers must never combine it with an older gate snapshot.
 */
export const COMPLETION_FUNNEL_SCHEMA_VERSION = 1 as const

export type CompletionFunnelPhase =
	| "evaluating"
	| "ready"
	| "blocked"
	| "completed"
	| "failed"
	| "proposed"
	| "decision_accepted"
	| "decision_rejected"
	| "settling"
	| "settlement_failed"

export type CompletionFunnelDecisionKind = "allow_attempt" | "allow_probe" | "soft_block" | "hard_block" | "completed"

export type CompletionFunnelNextAction =
	| "attempt_completion"
	| "continue_execution"
	| "modify_workspace"
	| "stop_and_report"
	| "none"

export interface CompletionFunnelStage {
	stage: string
	result: "passed" | "failed" | "skipped" | "not_applicable"
	reason: string
	decisive: boolean
}

export interface CompletionFunnelEvent {
	schemaVersion: typeof COMPLETION_FUNNEL_SCHEMA_VERSION
	taskId: string
	phase: CompletionFunnelPhase
	kind: CompletionFunnelDecisionKind
	terminal: boolean
	nextAllowedAction: CompletionFunnelNextAction
	forbiddenActions: CompletionFunnelNextAction[]
	canonicalInstruction: string
	reason: string
	stages: CompletionFunnelStage[]
	graphRevision: number
	evaluatedAt: number
	decisionId?: string
	committedAt?: number
}

export function isTerminalCompletionFunnelEvent(
	event: CompletionFunnelEvent | undefined,
): event is CompletionFunnelEvent & { kind: "completed"; terminal: true } {
	return event?.kind === "completed" && event.terminal === true && event.phase === "completed"
}
