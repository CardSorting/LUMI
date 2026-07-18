export const TASK_LIFECYCLE_SCHEMA_VERSION = 1 as const

export type TaskLifecycleState = "registered" | "active" | "suspended" | "terminal"

export type TaskTerminalOutcome = "completed" | "cancelled" | "failed" | "timed_out"

export type TaskCancellationState =
	| { status: "none" }
	| {
			status: "requested"
			requestedAt: number
			requestEventId: string
			requestIntentId: string
	  }

export type TaskLifecycleTransitionType =
	| "register_generation"
	| "activate_generation"
	| "suspend_generation"
	| "resume_generation"
	| "replace_generation"
	| "request_cancellation"
	| "settle_cancellation"
	| "settle_completion"
	| "settle_failure"
	| "settle_timeout"
	| "propagate_parent_termination"

export type TaskLifecycleCausalSource =
	| "task"
	| "controller"
	| "execution_funnel"
	| "completion_funnel"
	| "subagent"
	| "parent_lifecycle"
	| "recovery"
	| "storage_restore"
	| "test"

export interface TaskLifecycleCause {
	source: TaskLifecycleCausalSource
	reason: string
	originatingOperationId?: string
	originatingEventId?: string
	/**
	 * Timestamp at which another authority durably committed its semantic fact.
	 * This is used only to order that fact against an already-recorded lifecycle
	 * fence; it is never inferred from callback arrival.
	 */
	authoritativeAt?: number
}

export interface TaskParentLink {
	taskId: string
	generationId: string
	governance: "attached" | "detached"
}

export interface TaskLifecycleRecord {
	schemaVersion: typeof TASK_LIFECYCLE_SCHEMA_VERSION
	taskId: string
	generationId: string
	lifecycleRevision: number
	state: TaskLifecycleState
	terminalOutcome?: TaskTerminalOutcome
	cancellation: TaskCancellationState
	cause: TaskLifecycleCause
	parent?: TaskParentLink
	lastEventId: string
	committedAt: number
	monotonicSequence: number
}

export interface TaskLifecycleSnapshot {
	generationId: string
	lifecycleRevision: number
	state: TaskLifecycleState
	terminalOutcome?: TaskTerminalOutcome
	cancellation: TaskCancellationState
	lastEventId: string
	committedAt: number
	monotonicSequence: number
}

export interface TaskLifecycleEvent {
	schemaVersion: typeof TASK_LIFECYCLE_SCHEMA_VERSION
	eventId: string
	intentId: string
	taskId: string
	generationId: string
	lifecycleRevision: number
	transition: TaskLifecycleTransitionType
	previous?: TaskLifecycleSnapshot
	committed: TaskLifecycleSnapshot
	terminalOutcome?: TaskTerminalOutcome
	cause: TaskLifecycleCause
	parent?: TaskParentLink
	originatingOperationId?: string
	originatingEventId?: string
	committedAt: number
	monotonicSequence: number
	metadata?: Readonly<Record<string, string | number | boolean>>
}

interface BaseTaskLifecycleIntent {
	intentId: string
	taskId: string
	generationId: string
	cause: TaskLifecycleCause
}

export interface RegisterGenerationIntent extends BaseTaskLifecycleIntent {
	type: "RegisterGeneration"
	parent?: TaskParentLink
}

export interface ActivateGenerationIntent extends BaseTaskLifecycleIntent {
	type: "ActivateGeneration"
}

export interface SuspendGenerationIntent extends BaseTaskLifecycleIntent {
	type: "SuspendGeneration"
}

export interface ResumeWithGenerationIntent extends BaseTaskLifecycleIntent {
	type: "ResumeWithGeneration"
	/**
	 * Omit to continue an explicitly suspended generation. A terminal or
	 * deliberately replaced generation requires a fresh identifier.
	 */
	newGenerationId?: string
}

export interface RequestCancellationIntent extends BaseTaskLifecycleIntent {
	type: "RequestCancellation"
}

export interface SettleCancellationIntent extends BaseTaskLifecycleIntent {
	type: "SettleCancellation"
	metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface SettleCompletionIntent extends BaseTaskLifecycleIntent {
	type: "SettleCompletion"
}

export interface SettleFailureIntent extends BaseTaskLifecycleIntent {
	type: "SettleFailure"
	metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface SettleTimeoutIntent extends BaseTaskLifecycleIntent {
	type: "SettleTimeout"
	metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface PropagateParentTerminationIntent extends BaseTaskLifecycleIntent {
	type: "PropagateParentTermination"
	parentEventId: string
	parentOutcome: Exclude<TaskTerminalOutcome, "completed">
}

export type TaskLifecycleIntent =
	| RegisterGenerationIntent
	| ActivateGenerationIntent
	| SuspendGenerationIntent
	| ResumeWithGenerationIntent
	| RequestCancellationIntent
	| SettleCancellationIntent
	| SettleCompletionIntent
	| SettleFailureIntent
	| SettleTimeoutIntent
	| PropagateParentTerminationIntent

export type TaskLifecycleRejectionCode =
	| "unknown_generation"
	| "stale_generation"
	| "invalid_transition"
	| "terminal_generation"
	| "duplicate_intent"
	| "cancellation_fenced"
	| "cancellation_not_requested"
	| "parent_constraint"
	| "persistence_failed"
	| "compare_and_swap_failed"
	| "malformed_intent"

export type TaskLifecycleTransitionResult =
	| {
			kind: "committed"
			record: TaskLifecycleRecord
			event: TaskLifecycleEvent
	  }
	| {
			kind: "rejected"
			code: TaskLifecycleRejectionCode
			reason: string
			current?: TaskLifecycleRecord
	  }

export interface TaskLifecycleEligibility {
	eligible: boolean
	taskId: string
	generationId: string
	revision?: number
	reason?: string
}

export function isTaskLifecycleTerminal(record: TaskLifecycleRecord | undefined): boolean {
	return record?.state === "terminal"
}

export function isTaskCancellationPending(record: TaskLifecycleRecord | undefined): boolean {
	return record?.cancellation.status === "requested"
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function isCause(value: unknown): value is TaskLifecycleCause {
	if (!isObject(value) || !isIdentity(value.reason)) return false
	return (
		[
			"task",
			"controller",
			"execution_funnel",
			"completion_funnel",
			"subagent",
			"parent_lifecycle",
			"recovery",
			"storage_restore",
			"test",
		].includes(String(value.source)) &&
		(value.originatingOperationId === undefined || isIdentity(value.originatingOperationId)) &&
		(value.originatingEventId === undefined || isIdentity(value.originatingEventId)) &&
		(value.authoritativeAt === undefined ||
			(typeof value.authoritativeAt === "number" && Number.isFinite(value.authoritativeAt)))
	)
}

function isCancellation(value: unknown): value is TaskCancellationState {
	if (!isObject(value)) return false
	if (value.status === "none") return true
	return (
		value.status === "requested" &&
		typeof value.requestedAt === "number" &&
		Number.isFinite(value.requestedAt) &&
		isIdentity(value.requestEventId) &&
		isIdentity(value.requestIntentId)
	)
}

function isParent(value: unknown): value is TaskParentLink {
	return (
		isObject(value) &&
		isIdentity(value.taskId) &&
		isIdentity(value.generationId) &&
		(value.governance === "attached" || value.governance === "detached")
	)
}

function isSnapshot(value: unknown): value is TaskLifecycleSnapshot {
	if (!isObject(value)) return false
	const terminalOutcome =
		value.terminalOutcome === "completed" ||
		value.terminalOutcome === "cancelled" ||
		value.terminalOutcome === "failed" ||
		value.terminalOutcome === "timed_out"
	const state =
		value.state === "registered" || value.state === "active" || value.state === "suspended" || value.state === "terminal"
	return (
		isIdentity(value.generationId) &&
		Number.isSafeInteger(value.lifecycleRevision) &&
		Number(value.lifecycleRevision) > 0 &&
		state &&
		(value.state === "terminal" ? terminalOutcome : value.terminalOutcome === undefined) &&
		isCancellation(value.cancellation) &&
		isIdentity(value.lastEventId) &&
		typeof value.committedAt === "number" &&
		Number.isFinite(value.committedAt) &&
		Number.isSafeInteger(value.monotonicSequence) &&
		Number(value.monotonicSequence) > 0
	)
}

/** Runtime guard used at persistence and transport restoration boundaries. */
export function isTaskLifecycleRecord(value: unknown): value is TaskLifecycleRecord {
	if (!isObject(value)) return false
	const terminalOutcome =
		value.terminalOutcome === "completed" ||
		value.terminalOutcome === "cancelled" ||
		value.terminalOutcome === "failed" ||
		value.terminalOutcome === "timed_out"
	const state =
		value.state === "registered" || value.state === "active" || value.state === "suspended" || value.state === "terminal"
	return (
		value.schemaVersion === TASK_LIFECYCLE_SCHEMA_VERSION &&
		isIdentity(value.taskId) &&
		isIdentity(value.generationId) &&
		Number.isSafeInteger(value.lifecycleRevision) &&
		Number(value.lifecycleRevision) > 0 &&
		state &&
		(value.state === "terminal" ? terminalOutcome : value.terminalOutcome === undefined) &&
		isCancellation(value.cancellation) &&
		isCause(value.cause) &&
		(value.parent === undefined || (isParent(value.parent) && value.parent.taskId !== value.taskId)) &&
		isIdentity(value.lastEventId) &&
		typeof value.committedAt === "number" &&
		Number.isFinite(value.committedAt) &&
		Number.isSafeInteger(value.monotonicSequence) &&
		Number(value.monotonicSequence) > 0
	)
}

export function isTaskLifecycleEvent(value: unknown): value is TaskLifecycleEvent {
	if (!isObject(value)) return false
	const metadataValid =
		value.metadata === undefined ||
		(isObject(value.metadata) &&
			Object.values(value.metadata).every(
				(entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean",
			))
	return (
		value.schemaVersion === TASK_LIFECYCLE_SCHEMA_VERSION &&
		isIdentity(value.eventId) &&
		isIdentity(value.intentId) &&
		isIdentity(value.taskId) &&
		isIdentity(value.generationId) &&
		Number.isSafeInteger(value.lifecycleRevision) &&
		Number(value.lifecycleRevision) > 0 &&
		[
			"register_generation",
			"activate_generation",
			"suspend_generation",
			"resume_generation",
			"replace_generation",
			"request_cancellation",
			"settle_cancellation",
			"settle_completion",
			"settle_failure",
			"settle_timeout",
			"propagate_parent_termination",
		].includes(String(value.transition)) &&
		(value.previous === undefined || isSnapshot(value.previous)) &&
		isSnapshot(value.committed) &&
		value.committed.generationId === value.generationId &&
		value.committed.lifecycleRevision === value.lifecycleRevision &&
		value.committed.lastEventId === value.eventId &&
		value.terminalOutcome === value.committed.terminalOutcome &&
		isCause(value.cause) &&
		(value.parent === undefined || (isParent(value.parent) && value.parent.taskId !== value.taskId)) &&
		(value.originatingOperationId === undefined || isIdentity(value.originatingOperationId)) &&
		(value.originatingEventId === undefined || isIdentity(value.originatingEventId)) &&
		typeof value.committedAt === "number" &&
		Number.isFinite(value.committedAt) &&
		value.committedAt === value.committed.committedAt &&
		Number.isSafeInteger(value.monotonicSequence) &&
		Number(value.monotonicSequence) > 0 &&
		value.monotonicSequence === value.committed.monotonicSequence &&
		metadataValid
	)
}

/** Proves that a restored event is the exact immutable event referenced by a record. */
export function isTaskLifecycleEventForRecord(event: unknown, record: TaskLifecycleRecord): event is TaskLifecycleEvent {
	if (!isTaskLifecycleEvent(event)) return false
	return (
		event.eventId === record.lastEventId &&
		event.taskId === record.taskId &&
		event.generationId === record.generationId &&
		event.lifecycleRevision === record.lifecycleRevision &&
		event.committed.generationId === record.generationId &&
		event.committed.lifecycleRevision === record.lifecycleRevision &&
		event.committed.state === record.state &&
		event.committed.terminalOutcome === record.terminalOutcome &&
		event.committed.lastEventId === record.lastEventId &&
		event.committed.committedAt === record.committedAt &&
		event.committed.monotonicSequence === record.monotonicSequence &&
		event.committedAt === record.committedAt &&
		event.monotonicSequence === record.monotonicSequence &&
		event.originatingOperationId === record.cause.originatingOperationId &&
		event.originatingEventId === record.cause.originatingEventId &&
		JSON.stringify(event.committed.cancellation) === JSON.stringify(record.cancellation) &&
		JSON.stringify(event.cause) === JSON.stringify(record.cause) &&
		JSON.stringify(event.parent) === JSON.stringify(record.parent)
	)
}
