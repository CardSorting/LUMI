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
})
