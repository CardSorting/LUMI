import { strict as assert } from "node:assert"
import { beforeEach, describe, it } from "mocha"
import { SUBAGENT_IO_LANE_RESULT_MIN_LENGTH } from "@/shared/audit/gatePolicy"
import { TaskState } from "../../TaskState"
import { runSubagentCompletionLanePreflight } from "../completionGatePipeline"
import { validateSubagentCompletionGates } from "../subagentCompletionGates"
import type { TaskConfig } from "../types/TaskConfig"

const VALID_RESULT = "Investigated authentication module and documented JWT refresh rotation gaps across three service files."

const IO_LANE_RESULT = "Read src/auth.ts; JWT refresh missing in token handler."

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskId: "subagent-task",
		ulid: "ulid-sub",
		cwd: "/tmp",
		taskState,
		isSubagentExecution: true,
		auditCompletionGateEnabled: true,
		auditCompletionGateThreshold: 80,
		messageState: { getDietCodeMessages: () => [] },
	} as unknown as TaskConfig
}

describe("subagentCompletionGates", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	it("blocks lane on quality preflight without incrementing parent gate block count", () => {
		const config = configWithState(taskState)
		const error = runSubagentCompletionLanePreflight(config, { result: "   " })
		assert.ok(error)
		assert.equal(taskState.completionGateBlockCount, undefined)
		assert.ok((taskState.consecutiveMistakeCount ?? 0) > 0)
	})

	it("defers hardening audit to seal barrier without calling auditTask", async () => {
		const config = configWithState(taskState)
		const result = await validateSubagentCompletionGates(config, VALID_RESULT, undefined, undefined, {
			laneExecutionMode: "read_only",
		})

		assert.equal(result.error, null)
		assert.equal(result.auditDeferredToSeal, true)
		assert.equal(taskState.completionGateBlockCount, undefined)
	})

	it("uses relaxed min length for I/O authority lanes", () => {
		const config = configWithState(taskState)
		const shortButValid = "x".repeat(SUBAGENT_IO_LANE_RESULT_MIN_LENGTH)
		const error = runSubagentCompletionLanePreflight(config, {
			result: shortButValid,
			laneExecutionMode: "read_only",
		})
		assert.equal(error, null)
	})

	it("enforces parent min length for mutation lanes", () => {
		const config = configWithState(taskState)
		const tooShort = "x".repeat(SUBAGENT_IO_LANE_RESULT_MIN_LENGTH)
		const error = runSubagentCompletionLanePreflight(config, {
			result: tooShort,
			laneExecutionMode: "mutation",
		})
		assert.ok(error?.includes("too brief"))
	})

	it("accepts concise I/O lane summaries", () => {
		const config = configWithState(taskState)
		const error = runSubagentCompletionLanePreflight(config, {
			result: IO_LANE_RESULT,
			laneExecutionMode: "diagnostic_only",
		})
		assert.equal(error, null)
	})

	it("skips parent-only preflight stages for lane completion", () => {
		const config = {
			...configWithState(taskState),
			focusChainSettings: { enabled: true },
		} as TaskConfig
		taskState.currentFocusChainChecklist = "- [ ] unfinished item"

		const error = runSubagentCompletionLanePreflight(config, { result: VALID_RESULT })
		assert.equal(error, null)
	})
})
