/**
 * TaskLifecycleFunnel is the single transactional authority for task lifecycle.
 *
 * Callers submit facts and typed transition intents. They never replace state.
 * The funnel validates generation and causal fences, commits record + event with
 * compare-and-swap protection, and only then publishes an immutable event.
 */
import { randomUUID } from "node:crypto"
import type {
	TaskLifecycleCause,
	TaskLifecycleEligibility,
	TaskLifecycleEvent,
	TaskLifecycleIntent,
	TaskLifecycleRecord,
	TaskLifecycleSnapshot,
	TaskLifecycleTransitionResult,
	TaskParentLink,
	TaskTerminalOutcome,
} from "@shared/lifecycle/taskLifecycleEvent"
import {
	isTaskLifecycleEventForRecord,
	isTaskLifecycleRecord,
	TASK_LIFECYCLE_SCHEMA_VERSION,
} from "@shared/lifecycle/taskLifecycleEvent"
import type { TaskState } from "../TaskState"
import {
	InMemoryTaskLifecyclePersistence,
	SqliteTaskLifecyclePersistence,
	type TaskLifecyclePersistence,
} from "./TaskLifecyclePersistence"

const MAX_PROJECTED_LIFECYCLE_EVENTS = 100

type TaskLifecycleListener = (event: TaskLifecycleEvent) => void | Promise<void>

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
	Object.freeze(value)
	for (const child of Object.values(value as Record<string, unknown>)) {
		deepFreeze(child)
	}
	return value
}

function immutable<T>(value: T): T {
	return deepFreeze(clone(value))
}

function snapshot(record: TaskLifecycleRecord): TaskLifecycleSnapshot {
	return {
		generationId: record.generationId,
		lifecycleRevision: record.lifecycleRevision,
		state: record.state,
		terminalOutcome: record.terminalOutcome,
		cancellation: clone(record.cancellation),
		lastEventId: record.lastEventId,
		committedAt: record.committedAt,
		monotonicSequence: record.monotonicSequence,
	}
}

function rejected(
	code: Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>["code"],
	reason: string,
	current?: TaskLifecycleRecord,
): TaskLifecycleTransitionResult {
	return { kind: "rejected", code, reason, current: current ? immutable(current) : undefined }
}

function validIdentity(value: string | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function terminalOutcomeForIntent(intent: TaskLifecycleIntent): TaskTerminalOutcome | undefined {
	switch (intent.type) {
		case "SettleCompletion":
			return "completed"
		case "SettleCancellation":
			return "cancelled"
		case "SettleFailure":
			return "failed"
		case "SettleTimeout":
			return "timed_out"
		case "PropagateParentTermination":
			return intent.parentOutcome
		default:
			return undefined
	}
}

function transitionName(intent: TaskLifecycleIntent, replacingGeneration: boolean) {
	switch (intent.type) {
		case "RegisterGeneration":
			return "register_generation" as const
		case "ActivateGeneration":
			return "activate_generation" as const
		case "SuspendGeneration":
			return "suspend_generation" as const
		case "ReactivateAfterCompletionRejection":
			return "reactivate_after_completion_rejection" as const
		case "ResumeWithGeneration":
			return replacingGeneration ? ("replace_generation" as const) : ("resume_generation" as const)
		case "RequestCancellation":
			return "request_cancellation" as const
		case "SettleCancellation":
			return "settle_cancellation" as const
		case "SettleCompletion":
			return "settle_completion" as const
		case "SettleFailure":
			return "settle_failure" as const
		case "SettleTimeout":
			return "settle_timeout" as const
		case "PropagateParentTermination":
			return "propagate_parent_termination" as const
	}
}

export function createTaskLifecycleIntentId(): string {
	return randomUUID()
}

export function createTaskGenerationId(): string {
	return randomUUID()
}

export class TaskLifecycleFunnel {
	private readonly listeners = new Set<TaskLifecycleListener>()
	private readonly taskTails = new Map<string, Promise<void>>()
	private readonly projectedTaskStates = new Map<string, TaskState>()
	private readonly activeEnsures = new Map<string, Promise<TaskLifecycleTransitionResult>>()
	private readonly authoritativeRecords = new Map<string, TaskLifecycleRecord>()

	constructor(private readonly persistence: TaskLifecyclePersistence) {}

	subscribe(listener: TaskLifecycleListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	async load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		const record = await this.persistence.load(taskId)
		if (!record) return undefined
		const accepted = immutable(record)
		this.authoritativeRecords.set(taskId, accepted)
		return accepted
	}

	readProjection(taskState: TaskState): TaskLifecycleRecord | undefined {
		if (!taskState.lifecycleFunnelRecordJson) return undefined
		try {
			const record = JSON.parse(taskState.lifecycleFunnelRecordJson) as unknown
			return isTaskLifecycleRecord(record) ? immutable(record) : undefined
		} catch {
			return undefined
		}
	}

	async restore(taskState: TaskState, taskId: string): Promise<TaskLifecycleRecord | undefined> {
		const record = await this.load(taskId)
		if (record) {
			const event = await this.persistence.loadEvent(record.lastEventId)
			if (!event || !isTaskLifecycleEventForRecord(event, record)) {
				throw new Error(
					`Lifecycle record '${taskId}' references a missing, malformed, or mismatched event '${record.lastEventId}'.`,
				)
			}
			this.project(taskState, record, event)
			// Parent settlement and child settlement are separate generation-bound
			// commits. Replaying propagation on restore closes the process-crash
			// window without inventing state or publishing an uncommitted event.
			await this.propagateToAttachedChildren(record, event)
		}
		return record
	}

	async registerAndActivate(
		taskState: TaskState,
		taskId: string,
		cause: TaskLifecycleCause,
		parent?: TaskParentLink,
	): Promise<TaskLifecycleTransitionResult> {
		const existing = await this.restore(taskState, taskId)
		if (existing) {
			if (existing.state === "registered") {
				return this.submit(taskState, {
					type: "ActivateGeneration",
					intentId: createTaskLifecycleIntentId(),
					taskId,
					generationId: existing.generationId,
					cause,
				})
			}
			return rejected(
				existing.state === "active" ? "invalid_transition" : "terminal_generation",
				`Task '${taskId}' already has lifecycle state '${existing.state}'.`,
				existing,
			)
		}

		const generationId = taskState.executionGeneration
		const registered = await this.submit(taskState, {
			type: "RegisterGeneration",
			intentId: createTaskLifecycleIntentId(),
			taskId,
			generationId,
			cause,
			parent,
		})
		if (registered.kind === "rejected") return registered
		return this.submit(taskState, {
			type: "ActivateGeneration",
			intentId: createTaskLifecycleIntentId(),
			taskId,
			generationId,
			cause,
		})
	}

	/**
	 * Execution admission uses this exact read/transition contract. An absent
	 * record is registered and activated through this funnel; it is never treated
	 * as implicitly active.
	 */
	async ensureActive(
		taskState: TaskState,
		taskId: string,
		cause: TaskLifecycleCause,
		parent?: TaskParentLink,
	): Promise<TaskLifecycleTransitionResult> {
		const pending = this.activeEnsures.get(taskId)
		if (pending) {
			const result = await pending
			if (result.kind === "committed") this.project(taskState, result.record, result.event)
			return result
		}
		const ensure = this.ensureActiveTransaction(taskState, taskId, cause, parent).catch((error) =>
			rejected("persistence_failed", `Lifecycle activation failed: ${String(error)}`),
		)
		this.activeEnsures.set(taskId, ensure)
		try {
			return await ensure
		} finally {
			if (this.activeEnsures.get(taskId) === ensure) this.activeEnsures.delete(taskId)
		}
	}

	private async ensureActiveTransaction(
		taskState: TaskState,
		taskId: string,
		cause: TaskLifecycleCause,
		parent?: TaskParentLink,
	): Promise<TaskLifecycleTransitionResult> {
		const projected = this.readProjection(taskState)
		const current = projected?.taskId === taskId ? projected : await this.restore(taskState, taskId)
		if (!current) return this.registerAndActivate(taskState, taskId, cause, parent)
		if (current.state === "registered") {
			return this.submit(taskState, {
				type: "ActivateGeneration",
				intentId: createTaskLifecycleIntentId(),
				taskId,
				generationId: current.generationId,
				cause,
			})
		}
		if (current.state === "active" && current.cancellation.status === "none") {
			const parentRejection = await this.validateAttachedParentEligibility(current)
			if (parentRejection) return parentRejection
			const candidate = taskState.lifecycleFunnelEventJson
				? (JSON.parse(taskState.lifecycleFunnelEventJson) as unknown)
				: undefined
			const last = isTaskLifecycleEventForRecord(candidate, current) ? candidate : undefined
			if (last) return { kind: "committed", record: immutable(current), event: immutable(last) }
		}
		return rejected(
			current.state === "terminal" ? "terminal_generation" : "invalid_transition",
			`Task '${taskId}' is not eligible to become active from '${current.state}'${
				current.cancellation.status === "requested" ? " while cancellation is pending" : ""
			}.`,
			current,
		)
	}

	executionEligibility(taskState: TaskState, taskId: string, generationId: string): TaskLifecycleEligibility {
		const record = this.authoritativeRecords.get(taskId) ?? this.readProjection(taskState)
		if (!record) {
			return { eligible: false, taskId, generationId, reason: "No committed lifecycle record exists." }
		}
		if (record.taskId !== taskId || record.generationId !== generationId) {
			return {
				eligible: false,
				taskId,
				generationId,
				revision: record.lifecycleRevision,
				reason: "The operation targets a stale or foreign task generation.",
			}
		}
		if (record.state !== "active") {
			return {
				eligible: false,
				taskId,
				generationId,
				revision: record.lifecycleRevision,
				reason: `Lifecycle state '${record.state}' is not executable.`,
			}
		}
		if (record.cancellation.status === "requested") {
			return {
				eligible: false,
				taskId,
				generationId,
				revision: record.lifecycleRevision,
				reason: "Cancellation is pending and fences new execution.",
			}
		}
		if (record.parent?.governance === "attached") {
			const parent = this.authoritativeRecords.get(record.parent.taskId)
			if (
				parent &&
				(parent.generationId !== record.parent.generationId ||
					parent.state !== "active" ||
					parent.cancellation.status === "requested")
			) {
				return {
					eligible: false,
					taskId,
					generationId,
					revision: record.lifecycleRevision,
					reason: "The attached parent generation is no longer eligible for execution.",
				}
			}
		}
		return { eligible: true, taskId, generationId, revision: record.lifecycleRevision }
	}

	private async validateAttachedParentEligibility(
		record: TaskLifecycleRecord,
	): Promise<Extract<TaskLifecycleTransitionResult, { kind: "rejected" }> | undefined> {
		if (record.parent?.governance !== "attached") return undefined
		const parent = await this.load(record.parent.taskId)
		if (
			parent &&
			parent.generationId === record.parent.generationId &&
			parent.state === "active" &&
			parent.cancellation.status === "none"
		) {
			return undefined
		}
		return rejected(
			"parent_constraint",
			`Attached parent '${record.parent.taskId}' generation '${record.parent.generationId}' is absent, stale, fenced, or terminal.`,
			record,
		) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
	}

	async submit(taskState: TaskState | undefined, intent: TaskLifecycleIntent): Promise<TaskLifecycleTransitionResult> {
		if (!validIdentity(intent.intentId) || !validIdentity(intent.taskId) || !validIdentity(intent.generationId)) {
			return rejected("malformed_intent", "Lifecycle intents require non-empty intent, task, and generation identifiers.")
		}
		const previousTail = this.taskTails.get(intent.taskId) ?? Promise.resolve()
		let releaseTail: () => void = () => undefined
		const nextTail = new Promise<void>((resolve) => {
			releaseTail = resolve
		})
		const queuedTail = previousTail.then(() => nextTail)
		this.taskTails.set(intent.taskId, queuedTail)
		if (taskState) this.projectedTaskStates.set(intent.taskId, taskState)
		await previousTail
		try {
			return await this.submitSerialized(taskState, intent)
		} finally {
			releaseTail()
			if (this.taskTails.get(intent.taskId) === queuedTail) this.taskTails.delete(intent.taskId)
		}
	}

	private async submitSerialized(
		taskState: TaskState | undefined,
		intent: TaskLifecycleIntent,
	): Promise<TaskLifecycleTransitionResult> {
		let current: TaskLifecycleRecord | undefined
		try {
			current = await this.persistence.load(intent.taskId)
			if (current) this.authoritativeRecords.set(intent.taskId, immutable(current))
		} catch (error) {
			return rejected("persistence_failed", `Lifecycle load failed: ${String(error)}`)
		}

		if (intent.type !== "RegisterGeneration") {
			if (!current) return rejected("unknown_generation", `Task '${intent.taskId}' is not registered.`)
			if (current.generationId !== intent.generationId) {
				return rejected(
					"stale_generation",
					`Generation '${intent.generationId}' is stale; current generation is '${current.generationId}'.`,
					current,
				)
			}
			if (current.state === "terminal" && intent.type !== "ResumeWithGeneration") {
				return rejected(
					"terminal_generation",
					`Generation '${intent.generationId}' is terminal with outcome '${current.terminalOutcome}'.`,
					current,
				)
			}
		} else if (current) {
			return rejected(
				current.generationId === intent.generationId ? "invalid_transition" : "stale_generation",
				`Task '${intent.taskId}' already has generation '${current.generationId}'.`,
				current,
			)
		}

		const transition = this.evaluate(current, intent)
		if (transition.kind === "rejected") return transition

		const expectation = current
			? { generationId: current.generationId, lifecycleRevision: current.lifecycleRevision }
			: { absent: true as const }
		try {
			const committed = await this.persistence.commit(expectation, transition.record, transition.event)
			if (committed.kind === "duplicate_intent") {
				return rejected(
					"duplicate_intent",
					`Lifecycle intent '${intent.intentId}' was already committed as '${committed.event.eventId}'.`,
					committed.record,
				)
			}
			if (committed.kind === "compare_and_swap_failed") {
				return rejected(
					"compare_and_swap_failed",
					"The authoritative lifecycle revision changed before this transition could commit.",
					committed.current,
				)
			}
			if (committed.kind === "constraint_failed") {
				return rejected("parent_constraint", committed.reason, committed.current)
			}

			const record = immutable(committed.record)
			const event = immutable(committed.event)
			this.authoritativeRecords.set(record.taskId, record)
			if (taskState) this.project(taskState, record, event)
			for (const listener of this.listeners) {
				try {
					await listener(event)
				} catch {
					// Publication consumers cannot roll back or reinterpret a commit.
				}
			}
			await this.propagateToAttachedChildren(record, event)
			return { kind: "committed", record, event }
		} catch (error) {
			return rejected("persistence_failed", `Lifecycle commit failed: ${String(error)}`, current)
		}
	}

	private evaluate(
		current: TaskLifecycleRecord | undefined,
		intent: TaskLifecycleIntent,
	):
		| { kind: "accepted"; record: TaskLifecycleRecord; event: TaskLifecycleEvent }
		| Extract<TaskLifecycleTransitionResult, { kind: "rejected" }> {
		const now = Date.now()
		let generationId = intent.generationId
		let state = current?.state ?? "registered"
		let terminalOutcome = current?.terminalOutcome
		let cancellation = clone(current?.cancellation ?? { status: "none" as const })
		let parent = current?.parent
		let replacingGeneration = false
		let metadata: Readonly<Record<string, string | number | boolean>> | undefined

		switch (intent.type) {
			case "RegisterGeneration":
				state = "registered"
				parent = intent.parent
				break
			case "ActivateGeneration":
				if (current?.state !== "registered") {
					return rejected(
						"invalid_transition",
						`Only a registered generation may activate; current state is '${current?.state}'.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "active"
				break
			case "ReactivateAfterCompletionRejection":
				if (current?.state !== "suspended") {
					return rejected(
						"invalid_transition",
						`Only a suspended generation may reactivate after rejection; current state is '${current?.state}'.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (current.lifecycleRevision !== intent.expectedRevision) {
					return rejected(
						"stale_revision",
						`Expected revision ${intent.expectedRevision} but found current revision ${current.lifecycleRevision}.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (current.cancellation.status === "requested") {
					return rejected(
						"cancellation_fenced",
						"A cancellation-fenced generation cannot reactivate.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (current.cause.reason !== `awaiting_completion_decision:${intent.completionAttemptId}`) {
					return rejected(
						"invalid_transition",
						`Suspension reason mismatch. Expected completionAttemptId ${intent.completionAttemptId} but found cause reason '${current.cause.reason}'.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (current.cause.originatingOperationId !== intent.decisionId) {
					return rejected(
						"invalid_transition",
						`Suspension decisionId mismatch. Expected ${intent.decisionId} but found originatingOperationId '${current.cause.originatingOperationId}'.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "active"
				break
			case "SuspendGeneration":
				if (current?.state !== "active" || current.cancellation.status === "requested") {
					return rejected(
						"invalid_transition",
						"Only an active generation without a cancellation fence may suspend.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "suspended"
				break
			case "ResumeWithGeneration":
				if (current?.state === "suspended" && !intent.newGenerationId) {
					if (current.cancellation.status === "requested") {
						return rejected(
							"cancellation_fenced",
							"A cancellation-fenced generation cannot resume.",
							current,
						) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
					}
					state = "active"
					break
				}
				if (current?.state !== "suspended" && current?.state !== "terminal") {
					return rejected(
						"invalid_transition",
						`Generation replacement requires a suspended or terminal generation, not '${current?.state}'.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (!intent.newGenerationId || intent.newGenerationId === current?.generationId) {
					return rejected(
						current?.state === "terminal" ? "terminal_generation" : "invalid_transition",
						"A terminal or replaced lifecycle requires a distinct new generation identifier.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				generationId = intent.newGenerationId
				state = "active"
				terminalOutcome = undefined
				cancellation = { status: "none" }
				replacingGeneration = true
				break
			case "RequestCancellation":
				if (current?.cancellation.status === "requested") {
					return rejected(
						"duplicate_intent",
						"Cancellation is already pending for this generation.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (current?.state !== "active" && current?.state !== "suspended" && current?.state !== "registered") {
					return rejected(
						"invalid_transition",
						`Cancellation cannot be requested from '${current?.state}'.`,
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				cancellation = {
					status: "requested",
					requestedAt: now,
					requestEventId: "pending",
					requestIntentId: intent.intentId,
				}
				break
			case "SettleCancellation":
				if (current?.cancellation.status !== "requested") {
					return rejected(
						"cancellation_not_requested",
						"Cancellation cannot settle before its request is committed.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "terminal"
				terminalOutcome = "cancelled"
				metadata = intent.metadata
				break
			case "SettleCompletion":
				if (intent.cause.source !== "completion_funnel" && intent.cause.source !== "test") {
					return rejected(
						"invalid_transition",
						"Only an authoritative CompletionFunnel fact may settle successful completion.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (
					current?.cancellation.status === "requested" &&
					(intent.cause.authoritativeAt === undefined ||
						intent.cause.authoritativeAt >= current.cancellation.requestedAt)
				) {
					return rejected(
						"cancellation_fenced",
						"The committed cancellation request predates and fences this completion fact.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "terminal"
				terminalOutcome = "completed"
				break
			case "SettleFailure":
				if (current?.cancellation.status === "requested") {
					return rejected(
						"cancellation_fenced",
						"Pending cancellation deterministically wins over failure settlement.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "terminal"
				terminalOutcome = "failed"
				metadata = intent.metadata
				break
			case "SettleTimeout":
				if (current?.cancellation.status === "requested") {
					return rejected(
						"cancellation_fenced",
						"Pending cancellation deterministically wins over timeout settlement.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "terminal"
				terminalOutcome = "timed_out"
				metadata = intent.metadata
				break
			case "PropagateParentTermination":
				if (current?.parent?.governance !== "attached") {
					return rejected(
						"parent_constraint",
						"Detached or unparented generations do not accept parent termination propagation.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				if (current.parent.taskId === intent.taskId || intent.parentEventId.length === 0) {
					return rejected(
						"parent_constraint",
						"Parent termination propagation lacks a valid external parent event.",
						current,
					) as Extract<TaskLifecycleTransitionResult, { kind: "rejected" }>
				}
				state = "terminal"
				terminalOutcome = intent.parentOutcome
				metadata = { parentEventId: intent.parentEventId }
				break
		}

		const eventId = randomUUID()
		if (intent.type === "RequestCancellation") {
			cancellation = {
				...cancellation,
				status: "requested",
				requestEventId: eventId,
			} as typeof cancellation
		}
		const revision = (current?.lifecycleRevision ?? 0) + 1
		const record: TaskLifecycleRecord = {
			schemaVersion: TASK_LIFECYCLE_SCHEMA_VERSION,
			taskId: intent.taskId,
			generationId,
			lifecycleRevision: revision,
			state,
			terminalOutcome,
			cancellation,
			cause: clone(intent.cause),
			parent,
			lastEventId: eventId,
			committedAt: now,
			monotonicSequence: 0,
		}
		const event: TaskLifecycleEvent = {
			schemaVersion: TASK_LIFECYCLE_SCHEMA_VERSION,
			eventId,
			intentId: intent.intentId,
			taskId: intent.taskId,
			generationId,
			lifecycleRevision: revision,
			transition: transitionName(intent, replacingGeneration),
			previous: current ? snapshot(current) : undefined,
			committed: snapshot(record),
			terminalOutcome: terminalOutcomeForIntent(intent),
			cause: clone(intent.cause),
			parent,
			originatingOperationId: intent.cause.originatingOperationId,
			originatingEventId: intent.cause.originatingEventId,
			committedAt: now,
			monotonicSequence: 0,
			metadata,
		}
		return { kind: "accepted", record, event }
	}

	private project(taskState: TaskState, record: TaskLifecycleRecord, event?: TaskLifecycleEvent): void {
		this.projectedTaskStates.set(record.taskId, taskState)
		this.authoritativeRecords.set(record.taskId, record)
		taskState.lifecycleFunnelRecordJson = JSON.stringify(record)
		if (!event) return
		taskState.lifecycleFunnelEventJson = JSON.stringify(event)
		const history = [
			...(taskState.lifecycleFunnelHistory ?? []).filter((candidate) => candidate.eventId !== event.eventId),
			event,
		].slice(-MAX_PROJECTED_LIFECYCLE_EVENTS)
		taskState.lifecycleFunnelHistory = Object.freeze(history.map(immutable))
		if (event.transition === "replace_generation") {
			taskState.executionFunnelEventJson = undefined
			taskState.executionFunnelHistory = undefined
			taskState.executionInvocationLedger = {}
			taskState.completionFunnelEventJson = undefined
		}
	}

	private async propagateToAttachedChildren(record: TaskLifecycleRecord, event: TaskLifecycleEvent): Promise<void> {
		if (event.transition !== "request_cancellation" && record.state !== "terminal") return
		if (record.terminalOutcome === "completed") return
		const children = await this.persistence.listAttachedChildren({
			taskId: record.taskId,
			generationId: record.generationId,
			governance: "attached",
		})
		for (const child of children) {
			if (child.state === "terminal") continue
			const taskState = this.projectedTaskStates.get(child.taskId)
			if (event.transition === "request_cancellation" || record.terminalOutcome === "cancelled") {
				let current = child
				if (current.cancellation.status === "none") {
					const request = await this.submit(taskState, {
						type: "RequestCancellation",
						intentId: createTaskLifecycleIntentId(),
						taskId: current.taskId,
						generationId: current.generationId,
						cause: {
							source: "parent_lifecycle",
							reason: "The attached parent cancellation fence propagated to this child.",
							originatingEventId: event.eventId,
						},
					})
					if (request.kind === "rejected") continue
					current = request.record
				}
				if (record.terminalOutcome === "cancelled" && current.cancellation.status === "requested") {
					await this.submit(taskState, {
						type: "SettleCancellation",
						intentId: createTaskLifecycleIntentId(),
						taskId: current.taskId,
						generationId: current.generationId,
						cause: {
							source: "parent_lifecycle",
							reason: "The attached parent settled cancellation.",
							originatingEventId: event.eventId,
						},
					})
				}
				continue
			}
			if (record.terminalOutcome === "failed" || record.terminalOutcome === "timed_out") {
				await this.submit(taskState, {
					type: "PropagateParentTermination",
					intentId: createTaskLifecycleIntentId(),
					taskId: child.taskId,
					generationId: child.generationId,
					parentEventId: event.eventId,
					parentOutcome: record.terminalOutcome,
					cause: {
						source: "parent_lifecycle",
						reason: `The attached parent terminalized as '${record.terminalOutcome}'.`,
						originatingEventId: event.eventId,
					},
				})
			}
		}
	}
}

const taskAuthorityBindings = new WeakMap<TaskState, TaskLifecycleFunnel>()

export const taskLifecycleFunnel = new TaskLifecycleFunnel(new SqliteTaskLifecyclePersistence())

export function bindTaskLifecycleAuthority(taskState: TaskState, authority: TaskLifecycleFunnel): void {
	taskAuthorityBindings.set(taskState, authority)
}

export function getTaskLifecycleAuthority(taskState: TaskState): TaskLifecycleFunnel {
	const bound = taskAuthorityBindings.get(taskState)
	return bound ?? taskLifecycleFunnel
}

export function createInMemoryTaskLifecycleFunnel(): TaskLifecycleFunnel {
	return new TaskLifecycleFunnel(new InMemoryTaskLifecyclePersistence())
}
