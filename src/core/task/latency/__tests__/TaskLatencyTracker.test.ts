import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { TaskLatencyTracker } from "../TaskLatencyTracker"

describe("TaskLatencyTracker", () => {
	it("derives end-to-end and sibling durations from a monotonic clock", () => {
		let now = 0
		const tracker = new TaskLatencyTracker(() => now)
		now = 5
		tracker.mark("model_request_started")
		now = 12
		tracker.mark("first_model_token")
		now = 13
		tracker.mark("first_tool_recognized")
		now = 14
		tracker.mark("first_progress_visible")
		tracker.mark("sibling_queued", { invocationId: "a", sequence: 0, toolName: "read_file" })
		now = 15
		tracker.mark("tool_admitted")
		now = 16
		tracker.mark("tool_dispatch_started")
		now = 17
		tracker.mark("useful_io_started")
		tracker.mark("sibling_started", { invocationId: "a", sequence: 0, toolName: "read_file" })
		now = 27
		tracker.mark("sibling_completed", { invocationId: "a", status: "succeeded" })
		now = 30
		tracker.mark("completion_validation_started")
		now = 35
		tracker.mark("authoritative_completion_decided", { scope: "authoritative-result" })
		now = 36
		tracker.mark("result_presentation_started", { scope: "authoritative-result" })
		now = 40
		tracker.mark("result_presentation_completed", { scope: "authoritative-result" })
		now = 41
		tracker.mark("persistence_scheduled", { scope: "audit" })
		now = 51
		tracker.mark("persistence_completed", { scope: "audit" })

		const snapshot = tracker.snapshot()
		assert.equal(snapshot.taskAdmissionLatencyMs, 5)
		assert.equal(snapshot.timeToFirstModelTokenMs, 7)
		assert.equal(snapshot.timeToFirstRecognizedToolMs, 8)
		assert.equal(snapshot.timeToFirstVisibleProgressMs, 9)
		assert.equal(snapshot.presentationInducedDelayMs, 2)
		assert.equal(snapshot.timeToFirstToolDispatchMs, 11)
		assert.equal(snapshot.timeToFirstUsefulIoMs, 12)
		assert.equal(snapshot.tools[0].queueWaitMs, 3)
		assert.equal(snapshot.tools[0].executionMs, 10)
		assert.equal(snapshot.maxConcurrentSiblings, 1)
		assert.equal(snapshot.completionDecisionLatencyMs, 5)
		assert.equal(snapshot.authoritativeResultToVisibleResultMs, 5)
		assert.equal(snapshot.presentationOverheadMs, 4)
		assert.equal(snapshot.postResultPersistenceDurationMs, 10)
	})

	it("never blocks execution when the clock is unavailable", () => {
		const tracker = new TaskLatencyTracker(() => {
			throw new Error("clock unavailable")
		})
		assert.doesNotThrow(() => tracker.mark("model_request_started"))
		assert.deepEqual(tracker.snapshot().events, [])
	})

	it("records markOnce stages once per invocation and derives the I/O critical path", () => {
		let now = 0
		const tracker = new TaskLatencyTracker(() => now)
		const mark = (atMs: number, name: Parameters<TaskLatencyTracker["markIoStage"]>[0], invocationId = "read-a") => {
			now = atMs
			tracker.markIoStage(name, { invocationId, sequence: invocationId === "read-a" ? 0 : 1, toolName: "read_file" })
		}

		mark(1, "scheduler_ready")
		mark(2, "dispatch_entered")
		mark(3, "parameters_validated")
		mark(4, "authority_resolved")
		mark(5, "path_normalized")
		mark(6, "workspace_containment_verified")
		mark(7, "ignore_policy_resolved")
		mark(8, "cache_lookup")
		mark(9, "coalescer_admitted")
		mark(10, "backend_requested")
		mark(12, "backend_started")
		mark(15, "first_useful_result")
		mark(22, "backend_completed")
		mark(24, "envelope_completed")
		mark(27, "projection_ready")

		// The same stage is idempotent for one invocation but independent for another.
		mark(30, "backend_started")
		mark(31, "backend_started", "read-b")

		const snapshot = tracker.snapshot()
		const readA = snapshot.tools.find((tool) => tool.invocationId === "read-a")
		const readB = snapshot.tools.find((tool) => tool.invocationId === "read-b")
		assert.equal(
			snapshot.events.filter((event) => event.name === "backend_started" && event.invocationId === "read-a").length,
			1,
		)
		assert.equal(readB?.stages.backend_started, 31)
		assert.deepEqual(readA?.ioDurations, {
			readyToDispatchMs: 1,
			dispatchToParametersValidatedMs: 1,
			authorityResolutionMs: 1,
			pathNormalizationMs: 1,
			workspaceContainmentMs: 1,
			ignorePolicyResolutionMs: 1,
			cacheLookupMs: 1,
			coalescerAdmissionMs: 1,
			readyToBackendStartMs: 11,
			dispatchToBackendStartMs: 10,
			backendQueueMs: 2,
			readyToFirstUsefulResultMs: 14,
			backendToFirstUsefulResultMs: 3,
			backendDurationMs: 10,
			resultProcessingMs: 2,
			projectionMs: 3,
		})
	})

	it("keeps aggregate counters, gauges, and class pressure bounded and snapshot-isolated", () => {
		const tracker = new TaskLatencyTracker(() => 0)
		tracker.incrementCounter("statCalls", 2)
		tracker.incrementCounter("bytesRead", Number.MAX_SAFE_INTEGER)
		tracker.incrementCounter("bytesRead", 10)
		tracker.incrementCounter("cacheHits", Number.NaN)
		tracker.observeEventLoopDelay(4)
		tracker.observeEventLoopDelay(9)
		tracker.observeEventLoopDelay(-1)

		tracker.recordIoClassQueued("search")
		tracker.recordIoClassQueued("search")
		tracker.recordIoClassStarted("search")
		tracker.recordIoClassCompleted("search")
		tracker.recordIoClassCancelled("search")

		const snapshot = tracker.snapshot()
		assert.equal(snapshot.ioCounters.statCalls, 2)
		assert.equal(snapshot.ioCounters.bytesRead, Number.MAX_SAFE_INTEGER)
		assert.equal(snapshot.ioCounters.cacheHits, 0)
		assert.equal(snapshot.ioCounters.eventLoopDelaySamples, 2)
		assert.deepEqual(snapshot.ioGauges, { eventLoopDelayMs: 9, maxEventLoopDelayMs: 9 })
		assert.deepEqual(snapshot.ioClasses.search, {
			queued: 0,
			active: 0,
			maxQueued: 2,
			maxActive: 1,
			started: 1,
			completed: 1,
			cancelled: 1,
		})

		// Snapshots are projections, not mutable tracker authority.
		snapshot.ioCounters.statCalls = 99
		snapshot.ioClasses.search.active = 99
		const next = tracker.snapshot()
		assert.equal(next.ioCounters.statCalls, 2)
		assert.equal(next.ioClasses.search.active, 0)
	})

	it("retains a bounded chronological event ring under large batches", () => {
		let now = 0
		const tracker = new TaskLatencyTracker(() => now++)
		for (let index = 0; index < 1_100; index++) {
			tracker.mark("cache_lookup", { invocationId: `read-${index}` })
		}

		const events = tracker.snapshot().events
		assert.equal(events.length, 1_024)
		assert.ok(events.every((event, index) => index === 0 || event.atMs > events[index - 1].atMs))
		assert.equal(events.at(-1)?.atMs, 1_100)
	})
})
