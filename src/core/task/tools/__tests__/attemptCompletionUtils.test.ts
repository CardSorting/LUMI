import type { ToolUse } from "@core/assistant-message"
import { beforeEach, describe, it } from "mocha"
import "should"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { DietCodeDefaultTool } from "@shared/tools"
import { TaskState } from "../../TaskState"
import {
	canonicalizeAttemptCompletionParams,
	canonicalizeAttemptCompletionResultParams,
	checkCompletionGateCircuitBreaker,
	getCompletionGateCircuitBreakerError,
	markCompletionAttemptFinished,
	markCompletionGatesPassed,
	shouldRejectDoubleCheckCompletion,
} from "../attemptCompletionUtils"
import type { TaskConfig } from "../types/TaskConfig"

function configWithState(taskState: TaskState): TaskConfig {
	return { taskState } as TaskConfig
}

function attemptBlock(params: Record<string, unknown>): ToolUse {
	return {
		type: "tool_use",
		name: DietCodeDefaultTool.ATTEMPT,
		params,
		partial: false,
	}
}

describe("attemptCompletionUtils", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("canonicalizeAttemptCompletionParams", () => {
		it("maps response to result for attempt_completion", () => {
			const block = attemptBlock({ response: "done" })
			canonicalizeAttemptCompletionParams(block).should.be.true()
			block.params.result!.should.equal("done")
		})

		it("leaves an existing result unchanged", () => {
			const block = attemptBlock({ result: "already set", response: "ignored" })
			canonicalizeAttemptCompletionParams(block).should.be.false()
			block.params.result!.should.equal("already set")
		})
	})

	describe("canonicalizeAttemptCompletionResultParams", () => {
		it("maps response to result in subagent params", () => {
			const params: Record<string, unknown> = { response: "subagent done" }
			canonicalizeAttemptCompletionResultParams(params).should.be.true()
			;(params.result as string).should.equal("subagent done")
		})
	})

	describe("completion gate circuit breaker", () => {
		it("allows completion below the retry limit", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT - 1
			const config = configWithState(taskState)

			should.not.exist(getCompletionGateCircuitBreakerError(config))
			should.not.exist(checkCompletionGateCircuitBreaker(config))
		})

		it("blocks completion at the retry limit and increments consecutiveMistakeCount", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			const config = configWithState(taskState)

			const message = getCompletionGateCircuitBreakerError(config)
			should.exist(message)
			message!.should.containEql(String(MAX_COMPLETION_GATE_BLOCK_COUNT))
			taskState.consecutiveMistakeCount.should.equal(1)

			const toolError = checkCompletionGateCircuitBreaker(config)
			should.exist(toolError)
			toolError!.should.containEql("Task completion blocked")
		})
	})

	describe("gate state helpers", () => {
		it("clears consecutiveMistakeCount after gates pass", () => {
			taskState.consecutiveMistakeCount = 4
			markCompletionGatesPassed(configWithState(taskState))
			taskState.consecutiveMistakeCount.should.equal(0)
		})

		it("clears doubleCheckCompletionPending after a finished attempt", () => {
			taskState.doubleCheckCompletionPending = true
			markCompletionAttemptFinished(configWithState(taskState))
			taskState.doubleCheckCompletionPending.should.be.false()
		})
	})

	describe("shouldRejectDoubleCheckCompletion", () => {
		it("does not reject when double-check is disabled", () => {
			shouldRejectDoubleCheckCompletion(false, false).should.be.false()
			shouldRejectDoubleCheckCompletion(false, true).should.be.false()
		})

		it("rejects the first call and accepts the verified follow-up", () => {
			shouldRejectDoubleCheckCompletion(true, false).should.be.true()
			shouldRejectDoubleCheckCompletion(true, true).should.be.false()
		})

		it("preserves pending across gate blocks until completion finishes", () => {
			taskState.doubleCheckCompletionPending = true
			shouldRejectDoubleCheckCompletion(true, taskState.doubleCheckCompletionPending).should.be.false()

			markCompletionAttemptFinished(configWithState(taskState))
			shouldRejectDoubleCheckCompletion(true, taskState.doubleCheckCompletionPending).should.be.true()
		})

		it("double-checks every successful completion cycle", () => {
			const simulateSuccessfulCompletion = () => {
				shouldRejectDoubleCheckCompletion(true, taskState.doubleCheckCompletionPending).should.be.true()
				taskState.doubleCheckCompletionPending = true
				shouldRejectDoubleCheckCompletion(true, taskState.doubleCheckCompletionPending).should.be.false()
				markCompletionAttemptFinished(configWithState(taskState))
			}

			simulateSuccessfulCompletion()
			simulateSuccessfulCompletion()
			shouldRejectDoubleCheckCompletion(true, taskState.doubleCheckCompletionPending).should.be.true()
		})
	})
})
