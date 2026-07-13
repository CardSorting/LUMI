export const TASK_IO_LATENCY_STAGES = [
	"scheduler_ready",
	"dispatch_entered",
	"parameters_validated",
	"authority_resolved",
	"path_normalized",
	"workspace_containment_verified",
	"ignore_policy_resolved",
	"cache_lookup",
	"coalescer_admitted",
	"backend_requested",
	"backend_started",
	"first_useful_result",
	"backend_completed",
	"envelope_completed",
	"projection_ready",
] as const

export type TaskIoLatencyStage = (typeof TASK_IO_LATENCY_STAGES)[number]

export type TaskLatencyEventName =
	| "task_admitted"
	| "model_request_started"
	| "first_model_token"
	| "first_tool_recognized"
	| "first_progress_visible"
	| "tool_admitted"
	| "tool_dispatch_started"
	| "useful_io_started"
	| "useful_io_completed"
	| "sibling_queued"
	| "sibling_started"
	| "sibling_completed"
	| "completion_validation_started"
	| "authoritative_completion_decided"
	| "result_presentation_started"
	| "result_presentation_completed"
	| "persistence_scheduled"
	| "persistence_completed"
	| "persistence_failed"
	| TaskIoLatencyStage

export const TASK_IO_COUNTER_NAMES = [
	"statCalls",
	"lstatCalls",
	"realpathCalls",
	"accessCalls",
	"directoryReadCalls",
	"fileOpenCalls",
	"fileReadCalls",
	"repositorySearchSpawns",
	"shellSpawns",
	"cacheHits",
	"cacheMisses",
	"coalescedWaiters",
	"pathAuthorityCacheHits",
	"pathAuthorityCacheMisses",
	"ignorePolicyEvaluations",
	"bytesRead",
	"bytesCopied",
	"resultEnvelopeSerializationPasses",
	"eventLoopDelaySamples",
] as const

export type TaskIoCounterName = (typeof TASK_IO_COUNTER_NAMES)[number]
export type TaskIoCounters = Record<TaskIoCounterName, number>

export const TASK_IO_WORK_CLASSES = [
	"metadata",
	"small-read",
	"search",
	"traversal",
	"verification-command",
	"mutation-command",
	"interactive",
] as const

export type TaskIoWorkClass = (typeof TASK_IO_WORK_CLASSES)[number]

export interface TaskIoClassSnapshot {
	queued: number
	active: number
	maxQueued: number
	maxActive: number
	started: number
	completed: number
	cancelled: number
}

export interface TaskLatencyGauges {
	eventLoopDelayMs: number
	maxEventLoopDelayMs: number
}

export interface TaskLatencyEvent {
	name: TaskLatencyEventName
	atMs: number
	invocationId?: string
	sequence?: number
	toolName?: string
	status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped"
	scope?: string
	ioClass?: TaskIoWorkClass
}

export interface ToolIoLatencyDurations {
	readyToDispatchMs?: number
	dispatchToParametersValidatedMs?: number
	authorityResolutionMs?: number
	pathNormalizationMs?: number
	workspaceContainmentMs?: number
	ignorePolicyResolutionMs?: number
	cacheLookupMs?: number
	coalescerAdmissionMs?: number
	readyToBackendStartMs?: number
	dispatchToBackendStartMs?: number
	backendQueueMs?: number
	readyToFirstUsefulResultMs?: number
	backendToFirstUsefulResultMs?: number
	backendDurationMs?: number
	resultProcessingMs?: number
	projectionMs?: number
}

export interface ToolLatencySummary {
	invocationId: string
	sequence?: number
	toolName?: string
	queueWaitMs?: number
	executionMs?: number
	status?: TaskLatencyEvent["status"]
	stages: Partial<Record<TaskIoLatencyStage, number>>
	ioDurations: ToolIoLatencyDurations
}

export interface TaskLatencySnapshot {
	events: TaskLatencyEvent[]
	taskAdmissionLatencyMs?: number
	timeToFirstModelTokenMs?: number
	timeToFirstRecognizedToolMs?: number
	timeToFirstToolDispatchMs?: number
	timeToFirstUsefulIoMs?: number
	timeToFirstVisibleProgressMs?: number
	presentationInducedDelayMs?: number
	completionDecisionLatencyMs?: number
	authoritativeResultToVisibleResultMs?: number
	presentationOverheadMs?: number
	postResultPersistenceDurationMs?: number
	averageToolQueueWaitMs?: number
	maxConcurrentSiblings: number
	ioCounters: TaskIoCounters
	ioGauges: TaskLatencyGauges
	ioClasses: Record<TaskIoWorkClass, TaskIoClassSnapshot>
	tools: ToolLatencySummary[]
}

type MonotonicClock = () => number

const MAX_EVENTS = 1_024
const MAX_METRIC_VALUE = Number.MAX_SAFE_INTEGER

function emptyCounters(): TaskIoCounters {
	return {
		statCalls: 0,
		lstatCalls: 0,
		realpathCalls: 0,
		accessCalls: 0,
		directoryReadCalls: 0,
		fileOpenCalls: 0,
		fileReadCalls: 0,
		repositorySearchSpawns: 0,
		shellSpawns: 0,
		cacheHits: 0,
		cacheMisses: 0,
		coalescedWaiters: 0,
		pathAuthorityCacheHits: 0,
		pathAuthorityCacheMisses: 0,
		ignorePolicyEvaluations: 0,
		bytesRead: 0,
		bytesCopied: 0,
		resultEnvelopeSerializationPasses: 0,
		eventLoopDelaySamples: 0,
	}
}

function emptyIoClassSnapshot(): TaskIoClassSnapshot {
	return {
		queued: 0,
		active: 0,
		maxQueued: 0,
		maxActive: 0,
		started: 0,
		completed: 0,
		cancelled: 0,
	}
}

function emptyIoClasses(): Record<TaskIoWorkClass, TaskIoClassSnapshot> {
	return Object.fromEntries(TASK_IO_WORK_CLASSES.map((workClass) => [workClass, emptyIoClassSnapshot()])) as Record<
		TaskIoWorkClass,
		TaskIoClassSnapshot
	>
}

function boundedAdd(current: number, amount: number): number {
	return Math.min(MAX_METRIC_VALUE, current + amount)
}

function nonNegativeDuration(from?: number, to?: number): number | undefined {
	return from === undefined || to === undefined ? undefined : Math.max(0, to - from)
}

/**
 * Task-local, in-memory latency evidence. Recording is deliberately fail-open:
 * diagnostics must never become execution authority or response-path I/O.
 */
export class TaskLatencyTracker {
	private readonly events: TaskLatencyEvent[] = []
	private eventCursor = 0
	private activeSiblings = 0
	private maxConcurrentSiblings = 0
	private readonly ioCounters = emptyCounters()
	private readonly ioGauges: TaskLatencyGauges = { eventLoopDelayMs: 0, maxEventLoopDelayMs: 0 }
	private readonly ioClasses = emptyIoClasses()

	constructor(private readonly now: MonotonicClock = () => performance.now()) {
		this.mark("task_admitted")
	}

	mark(name: TaskLatencyEventName, detail: Omit<TaskLatencyEvent, "name" | "atMs"> = {}): void {
		try {
			const atMs = this.now()
			if (!Number.isFinite(atMs)) return
			const event = { name, atMs, ...detail }
			if (this.events.length < MAX_EVENTS) {
				this.events.push(event)
			} else {
				this.events[this.eventCursor] = event
				this.eventCursor = (this.eventCursor + 1) % MAX_EVENTS
			}
			if (name === "sibling_started") {
				this.activeSiblings++
				this.maxConcurrentSiblings = Math.max(this.maxConcurrentSiblings, this.activeSiblings)
			} else if (name === "sibling_completed") {
				this.activeSiblings = Math.max(0, this.activeSiblings - 1)
			}
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	/** Mark a task-global event once, or a stage once for each invocation when invocationId is present. */
	markOnce(name: TaskLatencyEventName, detail: Omit<TaskLatencyEvent, "name" | "atMs"> = {}): void {
		try {
			const invocationId = detail.invocationId
			const alreadyMarked = this.events.some(
				(event) => event.name === name && (invocationId === undefined || event.invocationId === invocationId),
			)
			if (alreadyMarked) return
			this.mark(name, detail)
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	markIoStage(name: TaskIoLatencyStage, detail: Omit<TaskLatencyEvent, "name" | "atMs"> & { invocationId: string }): void {
		this.markOnce(name, detail)
	}

	incrementCounter(name: TaskIoCounterName, amount = 1): void {
		try {
			if (!Number.isFinite(amount) || amount <= 0) return
			this.ioCounters[name] = boundedAdd(this.ioCounters[name], amount)
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	observeEventLoopDelay(delayMs: number): void {
		try {
			if (!Number.isFinite(delayMs) || delayMs < 0) return
			this.incrementCounter("eventLoopDelaySamples")
			this.ioGauges.eventLoopDelayMs = Math.min(MAX_METRIC_VALUE, delayMs)
			this.ioGauges.maxEventLoopDelayMs = Math.min(MAX_METRIC_VALUE, Math.max(this.ioGauges.maxEventLoopDelayMs, delayMs))
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	recordIoClassQueued(workClass: TaskIoWorkClass): void {
		try {
			const state = this.ioClasses[workClass]
			state.queued = boundedAdd(state.queued, 1)
			state.maxQueued = Math.max(state.maxQueued, state.queued)
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	recordIoClassStarted(workClass: TaskIoWorkClass): void {
		try {
			const state = this.ioClasses[workClass]
			state.queued = Math.max(0, state.queued - 1)
			state.active = boundedAdd(state.active, 1)
			state.maxActive = Math.max(state.maxActive, state.active)
			state.started = boundedAdd(state.started, 1)
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	recordIoClassCompleted(workClass: TaskIoWorkClass): void {
		try {
			const state = this.ioClasses[workClass]
			state.active = Math.max(0, state.active - 1)
			state.completed = boundedAdd(state.completed, 1)
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	recordIoClassCancelled(workClass: TaskIoWorkClass, from: "queued" | "active" = "queued"): void {
		try {
			const state = this.ioClasses[workClass]
			if (from === "active") {
				state.active = Math.max(0, state.active - 1)
			} else {
				state.queued = Math.max(0, state.queued - 1)
			}
			state.cancelled = boundedAdd(state.cancelled, 1)
		} catch {
			// Advisory instrumentation must never interrupt work.
		}
	}

	snapshot(): TaskLatencySnapshot {
		const events = this.eventsInOrder().map((event) => ({ ...event }))
		const firstByName = new Map<TaskLatencyEventName, TaskLatencyEvent>()
		const eventsByInvocation = new Map<string, TaskLatencyEvent[]>()
		for (const event of events) {
			if (!firstByName.has(event.name)) firstByName.set(event.name, event)
			if (event.invocationId) {
				const invocationEvents = eventsByInvocation.get(event.invocationId) ?? []
				invocationEvents.push(event)
				eventsByInvocation.set(event.invocationId, invocationEvents)
			}
		}
		const first = (name: TaskLatencyEventName, scope?: string) =>
			scope ? events.find((event) => event.name === name && event.scope === scope)?.atMs : firstByName.get(name)?.atMs
		const duration = (start: TaskLatencyEventName, end: TaskLatencyEventName, scope?: string): number | undefined =>
			nonNegativeDuration(first(start, scope), first(end, scope))

		const tools = [...eventsByInvocation.entries()].map(([invocationId, toolEvents]): ToolLatencySummary => {
			const queued = toolEvents.find((event) => event.name === "sibling_queued")
			const started = toolEvents.find((event) => event.name === "sibling_started")
			const completed = toolEvents.find((event) => event.name === "sibling_completed")
			const stages: Partial<Record<TaskIoLatencyStage, number>> = {}
			for (const stage of TASK_IO_LATENCY_STAGES) {
				const stageEvent = toolEvents.find((event) => event.name === stage)
				if (stageEvent) stages[stage] = stageEvent.atMs
			}
			const stageDuration = (from: TaskIoLatencyStage, to: TaskIoLatencyStage) =>
				nonNegativeDuration(stages[from], stages[to])
			return {
				invocationId,
				sequence:
					queued?.sequence ?? started?.sequence ?? toolEvents.find((event) => event.sequence !== undefined)?.sequence,
				toolName: queued?.toolName ?? started?.toolName ?? toolEvents.find((event) => event.toolName)?.toolName,
				queueWaitMs: queued && started ? Math.max(0, started.atMs - queued.atMs) : undefined,
				executionMs: started && completed ? Math.max(0, completed.atMs - started.atMs) : undefined,
				status: completed?.status,
				stages,
				ioDurations: {
					readyToDispatchMs: stageDuration("scheduler_ready", "dispatch_entered"),
					dispatchToParametersValidatedMs: stageDuration("dispatch_entered", "parameters_validated"),
					authorityResolutionMs: stageDuration("parameters_validated", "authority_resolved"),
					pathNormalizationMs: stageDuration("authority_resolved", "path_normalized"),
					workspaceContainmentMs: stageDuration("path_normalized", "workspace_containment_verified"),
					ignorePolicyResolutionMs: stageDuration("workspace_containment_verified", "ignore_policy_resolved"),
					cacheLookupMs: stageDuration("ignore_policy_resolved", "cache_lookup"),
					coalescerAdmissionMs: stageDuration("cache_lookup", "coalescer_admitted"),
					readyToBackendStartMs: stageDuration("scheduler_ready", "backend_started"),
					dispatchToBackendStartMs: stageDuration("dispatch_entered", "backend_started"),
					backendQueueMs: stageDuration("backend_requested", "backend_started"),
					readyToFirstUsefulResultMs: stageDuration("scheduler_ready", "first_useful_result"),
					backendToFirstUsefulResultMs: stageDuration("backend_started", "first_useful_result"),
					backendDurationMs: stageDuration("backend_started", "backend_completed"),
					resultProcessingMs: stageDuration("backend_completed", "envelope_completed"),
					projectionMs: stageDuration("envelope_completed", "projection_ready"),
				},
			}
		})
		const queueWaits = tools.flatMap((tool) => (tool.queueWaitMs === undefined ? [] : [tool.queueWaitMs]))
		const persistenceScheduled = [...events].reverse().find((event) => event.name === "persistence_scheduled")
		const persistenceSettled = [...events]
			.reverse()
			.find(
				(event) =>
					(event.name === "persistence_completed" || event.name === "persistence_failed") &&
					(!persistenceScheduled?.scope || event.scope === persistenceScheduled.scope),
			)

		return {
			events,
			taskAdmissionLatencyMs: duration("task_admitted", "model_request_started"),
			timeToFirstModelTokenMs: duration("model_request_started", "first_model_token"),
			timeToFirstRecognizedToolMs: duration("model_request_started", "first_tool_recognized"),
			timeToFirstToolDispatchMs: duration("model_request_started", "tool_dispatch_started"),
			timeToFirstUsefulIoMs: duration("model_request_started", "useful_io_started"),
			timeToFirstVisibleProgressMs: duration("model_request_started", "first_progress_visible"),
			presentationInducedDelayMs: duration("first_tool_recognized", "tool_admitted"),
			completionDecisionLatencyMs: duration("completion_validation_started", "authoritative_completion_decided"),
			authoritativeResultToVisibleResultMs: duration(
				"authoritative_completion_decided",
				"result_presentation_completed",
				"authoritative-result",
			),
			presentationOverheadMs: duration(
				"result_presentation_started",
				"result_presentation_completed",
				"authoritative-result",
			),
			postResultPersistenceDurationMs:
				persistenceScheduled && persistenceSettled
					? Math.max(0, persistenceSettled.atMs - persistenceScheduled.atMs)
					: undefined,
			averageToolQueueWaitMs:
				queueWaits.length > 0 ? queueWaits.reduce((total, value) => total + value, 0) / queueWaits.length : undefined,
			maxConcurrentSiblings: this.maxConcurrentSiblings,
			ioCounters: { ...this.ioCounters },
			ioGauges: { ...this.ioGauges },
			ioClasses: Object.fromEntries(
				TASK_IO_WORK_CLASSES.map((workClass) => [workClass, { ...this.ioClasses[workClass] }]),
			) as Record<TaskIoWorkClass, TaskIoClassSnapshot>,
			tools,
		}
	}

	private eventsInOrder(): TaskLatencyEvent[] {
		if (this.events.length < MAX_EVENTS || this.eventCursor === 0) return this.events.slice()
		return [...this.events.slice(this.eventCursor), ...this.events.slice(0, this.eventCursor)]
	}
}
