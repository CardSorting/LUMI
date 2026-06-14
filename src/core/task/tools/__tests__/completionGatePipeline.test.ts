import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { COMPLETION_RESULT_MAX_LENGTH, MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { setRoadmapConfigOverride } from "@/services/roadmap/RoadmapConfig"
import { TaskState } from "../../TaskState"
import { recordCompletionPreflightFailure, validateCompletionResultQuality } from "../attemptCompletionUtils"
import { runCompletionGateFlow, runCompletionPreflightChecks } from "../completionGatePipeline"
import type { TaskConfig } from "../types/TaskConfig"

const VALID_RESULT =
	"Implemented retry logic with exponential backoff across the completion gate pipeline. " +
	"All unit tests pass and the handler now wraps errors consistently."

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskState,
		ulid: "test-ulid",
		taskId: "test-task",
		cwd: "/tmp",
		auditCompletionGateEnabled: false,
		focusChainSettings: { enabled: false },
		messageState: {
			getDietCodeMessages: () => [],
		},
	} as TaskConfig
}

describe("completionGatePipeline", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
		setRoadmapConfigOverride({ enabled: false })
	})

	afterEach(() => {
		setRoadmapConfigOverride(null)
	})

	it("fail-fast circuit breaker before quality checks", async () => {
		taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
		const error = await runCompletionPreflightChecks(configWithState(taskState), { result: VALID_RESULT }, "Test", {
			validateQuality: validateCompletionResultQuality,
			onFailure: recordCompletionPreflightFailure,
		})
		should.exist(error)
		if (error === null) {
			throw new Error("expected circuit breaker error")
		}
		error.should.containEql("maximum completion gate retries")
		error.should.containEql("<completion_gate_recovery")
	})

	it("rejects non-demo commands like echo in preflight", async () => {
		const error = await runCompletionPreflightChecks(
			configWithState(taskState),
			{ result: VALID_RESULT, command: "echo hello world" },
			"Test",
			{
				validateQuality: validateCompletionResultQuality,
				onFailure: recordCompletionPreflightFailure,
			},
		)
		should.exist(error)
		if (error === null) {
			throw new Error("expected demo command error")
		}
		error.should.containEql("demo command")
		error.should.containEql('reason="invalid_demo_command"')
	})

	it("rejects result summaries exceeding max length in preflight", async () => {
		const tooLong = "x".repeat(COMPLETION_RESULT_MAX_LENGTH + 1)
		const error = await runCompletionPreflightChecks(configWithState(taskState), { result: tooLong }, "Test", {
			validateQuality: validateCompletionResultQuality,
			onFailure: recordCompletionPreflightFailure,
		})
		should.exist(error)
		if (error === null) {
			throw new Error("expected max length error")
		}
		error.should.containEql("exceeds maximum length")
		error.should.containEql('reason="result_too_long"')
	})

	it("runCompletionGateFlow passes when audit gate is disabled", async () => {
		const flow = await runCompletionGateFlow(configWithState(taskState), { result: VALID_RESULT }, "Test")
		flow.status.should.equal("passed")
	})
})
