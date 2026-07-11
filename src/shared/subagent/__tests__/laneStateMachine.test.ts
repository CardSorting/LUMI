import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { mergeGovernanceDiagnostics } from "../../../core/task/tools/subagent/CoordinatorExecutionAuthority"
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
