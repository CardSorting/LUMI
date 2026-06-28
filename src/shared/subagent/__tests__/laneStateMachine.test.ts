import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	evaluateCoordinatorFastContinuation,
	mergeGovernanceDiagnostics,
} from "../../../core/task/tools/subagent/CoordinatorExecutionAuthority"
import { resetSoftBlockRetryBudget } from "../blockerPolicy"
import {
	isOptionalAdvisoryLane,
	laneStateAllowsSwarmContinuation,
	laneStateShouldDegradeOnTimeout,
	mapEntryStatusToLaneState,
} from "../laneStateMachine"

describe("laneStateMachine", () => {
	it("maps partial running lane state", () => {
		assert.equal(
			mapEntryStatusToLaneState({
				entryStatus: "running",
				hasPartialResult: true,
			}),
			"partial",
		)
	})

	it("allows swarm continuation for degraded advisory lanes", () => {
		assert.equal(laneStateAllowsSwarmContinuation("degraded_complete", "read_only"), true)
		assert.equal(laneStateAllowsSwarmContinuation("hard_blocked", "read_only"), false)
	})

	it("degrades optional advisory lanes on timeout", () => {
		assert.equal(laneStateShouldDegradeOnTimeout("read_only"), true)
		assert.equal(laneStateShouldDegradeOnTimeout("mutation"), false)
		assert.equal(isOptionalAdvisoryLane("audit_only"), true)
	})
})

describe("evaluateCoordinatorFastContinuation", () => {
	it("continues when only advisory signals exist", () => {
		const decision = evaluateCoordinatorFastContinuation({
			taskId: "task-1",
			advisorySignalCount: 3,
		})
		assert.equal(decision.shouldContinue, true)
		assert.ok(decision.diagnostics.length > 0)
	})

	it("halts on coordinator-confirmed hard blockers", () => {
		const decision = evaluateCoordinatorFastContinuation({
			taskId: "task-2",
			proposedHardBlockers: ["split-brain lock authority detected"],
		})
		assert.equal(decision.shouldContinue, false)
	})

	it("consumes soft blocker retry budget then allows continuation with running lanes", () => {
		resetSoftBlockRetryBudget("task-soft")
		for (let i = 0; i < 3; i++) {
			const decision = evaluateCoordinatorFastContinuation({
				taskId: "task-soft",
				proposedSoftBlockers: ["retry cooldown"],
				hasRunningLanes: true,
			})
			assert.equal(decision.shouldContinue, true)
		}
		const exhausted = evaluateCoordinatorFastContinuation({
			taskId: "task-soft",
			proposedSoftBlockers: ["retry cooldown"],
			hasRunningLanes: true,
		})
		assert.equal(exhausted.shouldContinue, true)
		assert.ok(exhausted.diagnostics.some((d) => d.code === "no_progress_execution_loop"))
	})
})

describe("mergeGovernanceDiagnostics", () => {
	it("emits duplicate diagnostics once per condition", () => {
		const at = Date.now()
		const merged = mergeGovernanceDiagnostics(
			[{ code: "governance_recursion_detected", message: "same", at }],
			[{ code: "governance_recursion_detected", message: "same", at }],
		)
		assert.equal(merged.length, 1)
	})
})
