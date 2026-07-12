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

export interface TaskLatencyEvent {
	name: TaskLatencyEventName
	atMs: number
	invocationId?: string
	sequence?: number
	toolName?: string
	status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped"
	scope?: string
}

export interface ToolLatencySummary {
	invocationId: string
	sequence?: number
	toolName?: string
	queueWaitMs?: number
	executionMs?: number
	status?: TaskLatencyEvent["status"]
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
	tools: ToolLatencySummary[]
}

type MonotonicClock = () => number

const MAX_EVENTS = 1_024

/**
 * Task-local, in-memory latency evidence. Recording is deliberately fail-open:
 * diagnostics must never become execution authority or response-path I/O.
 */
export class TaskLatencyTracker {
	private readonly events: TaskLatencyEvent[] = []
	private activeSiblings = 0
	private maxConcurrentSiblings = 0

	constructor(private readonly now: MonotonicClock = () => performance.now()) {
		this.mark("task_admitted")
	}

	mark(name: TaskLatencyEventName, detail: Omit<TaskLatencyEvent, "name" | "atMs"> = {}): void {
		try {
			const atMs = this.now()
			if (!Number.isFinite(atMs)) return
			this.events.push({ name, atMs, ...detail })
			if (this.events.length > MAX_EVENTS) {
				this.events.splice(0, this.events.length - MAX_EVENTS)
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

	markOnce(name: TaskLatencyEventName, detail: Omit<TaskLatencyEvent, "name" | "atMs"> = {}): void {
		if (this.events.some((event) => event.name === name)) return
		this.mark(name, detail)
	}

	snapshot(): TaskLatencySnapshot {
		const events = this.events.map((event) => ({ ...event }))
		const first = (name: TaskLatencyEventName, scope?: string) =>
			events.find((event) => event.name === name && (!scope || event.scope === scope))?.atMs
		const duration = (start: TaskLatencyEventName, end: TaskLatencyEventName, scope?: string): number | undefined => {
			const from = first(start, scope)
			const to = first(end, scope)
			return from === undefined || to === undefined ? undefined : Math.max(0, to - from)
		}

		const invocationIds = [...new Set(events.map((event) => event.invocationId).filter(Boolean))] as string[]
		const tools = invocationIds.map((invocationId): ToolLatencySummary => {
			const toolEvents = events.filter((event) => event.invocationId === invocationId)
			const queued = toolEvents.find((event) => event.name === "sibling_queued")
			const started = toolEvents.find((event) => event.name === "sibling_started")
			const completed = toolEvents.find((event) => event.name === "sibling_completed")
			return {
				invocationId,
				sequence: queued?.sequence ?? started?.sequence,
				toolName: queued?.toolName ?? started?.toolName,
				queueWaitMs: queued && started ? Math.max(0, started.atMs - queued.atMs) : undefined,
				executionMs: started && completed ? Math.max(0, completed.atMs - started.atMs) : undefined,
				status: completed?.status,
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
			tools,
		}
	}
}
