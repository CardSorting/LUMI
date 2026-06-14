import type { ToolUse } from "@core/assistant-message"
import { beforeEach, describe, it } from "mocha"
import "should"
import {
	COMPLETION_GATE_WARN_THRESHOLD,
	COMPLETION_RESULT_MAX_LENGTH,
	MAX_COMPLETION_GATE_BLOCK_COUNT,
} from "@shared/audit/gatePolicy"
import { DietCodeDefaultTool } from "@shared/tools"
import { TaskState } from "../../TaskState"
import {
	appendCompletionGateRetryGuidance,
	buildCompletionAgentErrorMessage,
	buildCompletionGateEscalationBrief,
	buildCompletionGatePlaybook,
	buildCompletionGateRecoveryBlock,
	buildCompletionGateRetryGuidance,
	buildCompletionPreflightRecoveryHint,
	buildDoubleCheckReverifyMessage,
	buildProactiveCompletionGuidance,
	canonicalizeAttemptCompletionParams,
	canonicalizeAttemptCompletionResultParams,
	checkCompletionGateCircuitBreaker,
	classifyCompletionPreflightReason,
	detectDuplicateCompletionSubmission,
	extractFocusChainItemLabels,
	formatCompletionToolError,
	getCompletionGateCircuitBreakerError,
	getCompletionRetryCooldownMs,
	getLatestCheckpointHashFromMessages,
	hashCompletionResult,
	mapCompletionReasonToPreflightStage,
	markCompletionAttemptFinished,
	markCompletionGatesPassed,
	markProactiveCompletionGuidanceEmitted,
	recordCompletionAttemptTime,
	recordCompletionBlockReason,
	recordCompletionGateBlock,
	shouldEmitProactiveCompletionGuidance,
	shouldRejectDoubleCheckCompletion,
	validateCompletionAttemptCooldown,
	validateCompletionDemoCommand,
	validateCompletionPreflightQualityBundle,
	validateCompletionResultExcludesChecklist,
	validateCompletionResultMaxLength,
	validateCompletionResultMinLength,
	validateCompletionResultQuality,
	validateCompletionResultTone,
	validateCompletionTaskProgress,
	validateCompletionTaskProgressRequired,
	validateFocusChainComplete,
	validateTaskProgressAlignsWithFocusChain,
} from "../attemptCompletionUtils"
import type { TaskConfig } from "../types/TaskConfig"

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskState,
		focusChainSettings: { enabled: true },
		messageState: {
			getDietCodeMessages: () => [],
		},
	} as TaskConfig
}

function attemptBlock(params: Record<string, unknown>): ToolUse {
	return {
		type: "tool_use",
		name: DietCodeDefaultTool.ATTEMPT,
		params,
		partial: false,
	}
}

function expectErrorMessage(error: string | null, substring: string): void {
	should.exist(error)
	if (error === null) {
		throw new Error(`expected error containing "${substring}"`)
	}
	error.should.containEql(substring)
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
			;(block.params.result as string).should.equal("done")
		})

		it("leaves an existing result unchanged", () => {
			const block = attemptBlock({ result: "already set", response: "ignored" })
			canonicalizeAttemptCompletionParams(block).should.be.false()
			;(block.params.result as string).should.equal("already set")
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
			if (message === null) {
				throw new Error("expected circuit breaker message")
			}
			message.should.containEql(String(MAX_COMPLETION_GATE_BLOCK_COUNT))
			taskState.consecutiveMistakeCount.should.equal(1)

			const toolError = checkCompletionGateCircuitBreaker(config)
			should.exist(toolError)
			if (toolError === null) {
				throw new Error("expected circuit breaker tool error")
			}
			toolError.should.containEql("Task completion blocked")
		})
	})

	describe("validateCompletionDemoCommand", () => {
		it("rejects echo and cat demo commands", () => {
			expectErrorMessage(validateCompletionDemoCommand("echo hello"), "demo command")
			expectErrorMessage(validateCompletionDemoCommand("cat file.txt"), "demo command")
			should.not.exist(validateCompletionDemoCommand("npm run dev"))
		})
	})

	describe("buildCompletionGateRecoveryBlock", () => {
		it("emits structured recovery XML with reason code", () => {
			const block = buildCompletionGateRecoveryBlock("retry_cooldown")
			block.should.containEql('reason="retry_cooldown"')
			block.should.containEql("<completion_gate_recovery")
		})
	})

	describe("validateCompletionPreflightQualityBundle", () => {
		it("chains quality, checklist, and min-length validators", () => {
			expectErrorMessage(validateCompletionPreflightQualityBundle("   "), "empty")
			expectErrorMessage(validateCompletionPreflightQualityBundle("Done.\n- [x] item"), "must not contain checklist")
		})
	})

	describe("validateCompletionResultMinLength", () => {
		it("rejects summaries shorter than the minimum length", () => {
			expectErrorMessage(validateCompletionResultMinLength("Done."), "result is too brief")
		})
	})

	describe("validateCompletionResultMaxLength", () => {
		it("rejects summaries longer than the maximum length", () => {
			const tooLong = "x".repeat(COMPLETION_RESULT_MAX_LENGTH + 1)
			expectErrorMessage(validateCompletionResultMaxLength(tooLong), "exceeds maximum length")
		})
	})

	describe("mapCompletionReasonToPreflightStage", () => {
		it("maps block reasons to pipeline stage names", () => {
			mapCompletionReasonToPreflightStage("result_too_long").should.equal("max_length")
			mapCompletionReasonToPreflightStage("checklist_in_result").should.equal("checklist_in_result")
			mapCompletionReasonToPreflightStage("audit_gate").should.equal("audit")
			mapCompletionReasonToPreflightStage("double_check").should.equal("double_check")
		})
	})

	describe("buildCompletionGatePlaybook", () => {
		it("returns numbered runbook steps for recoverable reasons", () => {
			const playbook = buildCompletionGatePlaybook("result_too_long")
			playbook.should.containEql("Recovery playbook")
			playbook.should.containEql("1.")
			playbook.should.containEql("task_progress")
			buildCompletionGatePlaybook("circuit_breaker").should.equal("")
		})
	})

	describe("buildCompletionGateEscalationBrief", () => {
		it("escalates when remaining attempts drop to critical threshold", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT - 2
			buildCompletionGateEscalationBrief(configWithState(taskState)).should.containEql("Gate escalation")
		})
	})

	describe("proactive completion guidance debounce", () => {
		it("emits advisory only once per block count", () => {
			taskState.completionGateBlockCount = COMPLETION_GATE_WARN_THRESHOLD
			shouldEmitProactiveCompletionGuidance(configWithState(taskState)).should.be.true()
			markProactiveCompletionGuidanceEmitted(configWithState(taskState))
			shouldEmitProactiveCompletionGuidance(configWithState(taskState)).should.be.false()
		})
	})

	describe("validateCompletionResultExcludesChecklist", () => {
		it("rejects checklist content in the result summary", () => {
			expectErrorMessage(
				validateCompletionResultExcludesChecklist("Done.\n- [x] item one\n- [x] item two"),
				"must not contain checklist",
			)
		})
	})

	describe("validateTaskProgressAlignsWithFocusChain", () => {
		it("rejects task_progress with fewer items than the focus chain", () => {
			taskState.currentFocusChainChecklist = "- [x] one\n- [ ] two\n- [ ] three"
			expectErrorMessage(
				validateTaskProgressAlignsWithFocusChain(configWithState(taskState), "- [x] one"),
				"focus chain has 3",
			)
		})
	})

	describe("extractFocusChainItemLabels", () => {
		it("strips checkbox markers from checklist lines", () => {
			extractFocusChainItemLabels("- [x] done\n- [ ] pending").should.deepEqual(["done", "pending"])
		})
	})

	describe("proactive completion guidance", () => {
		it("emits advisory when approaching the gate circuit breaker", () => {
			taskState.completionGateBlockCount = COMPLETION_GATE_WARN_THRESHOLD - 1
			shouldEmitProactiveCompletionGuidance(configWithState(taskState)).should.be.true()
			buildProactiveCompletionGuidance(configWithState(taskState)).should.containEql("Completion gate advisory")
		})

		it("records block reason on the task state", () => {
			recordCompletionBlockReason(configWithState(taskState), "retry_cooldown")
			taskState.lastCompletionBlockReason.should.equal("retry_cooldown")
		})
	})

	describe("getCompletionRetryCooldownMs", () => {
		it("applies exponential backoff capped at max", () => {
			getCompletionRetryCooldownMs(1).should.equal(2000)
			getCompletionRetryCooldownMs(2).should.equal(4000)
			getCompletionRetryCooldownMs(5).should.equal(30_000)
			getCompletionRetryCooldownMs(10).should.equal(30_000)
		})
	})

	describe("validateCompletionTaskProgressRequired", () => {
		it("requires task_progress when focus chain has checklist items", () => {
			taskState.currentFocusChainChecklist = "- [x] done\n- [ ] pending"
			expectErrorMessage(
				validateCompletionTaskProgressRequired(configWithState(taskState), undefined),
				"task_progress is required",
			)
		})
	})

	describe("gate state helpers", () => {
		it("clears consecutiveMistakeCount and fingerprint after gates pass", () => {
			taskState.consecutiveMistakeCount = 4
			taskState.lastBlockedCompletionResultFingerprint = "abc123"
			taskState.lastGateBlockCheckpointHash = "hash1"
			markCompletionGatesPassed(configWithState(taskState))
			taskState.consecutiveMistakeCount.should.equal(0)
			should.not.exist(taskState.lastBlockedCompletionResultFingerprint)
			should.not.exist(taskState.lastGateBlockCheckpointHash)
		})

		it("clears doubleCheckCompletionPending, gate block count, and fingerprint after a finished attempt", () => {
			taskState.doubleCheckCompletionPending = true
			taskState.completionGateBlockCount = 4
			taskState.lastBlockedCompletionResultFingerprint = "abc123"
			markCompletionAttemptFinished(configWithState(taskState))
			taskState.doubleCheckCompletionPending.should.be.false()
			taskState.completionGateBlockCount.should.equal(0)
			should.not.exist(taskState.lastBlockedCompletionResultFingerprint)
		})
	})

	describe("validateCompletionResultQuality", () => {
		it("rejects empty and placeholder-marked results", () => {
			validateCompletionResultQuality("   ").should.containEql("empty")
			validateCompletionResultQuality("Done but TODO: fix tests").should.containEql("unfinished markers")
			should.not.exist(validateCompletionResultQuality("All tests pass and feature is complete."))
		})
	})

	describe("validateCompletionResultTone", () => {
		it("rejects question endings and engagement bait", () => {
			validateCompletionResultTone("All done.\nLet me know if you need anything else").should.containEql("solicits")
			validateCompletionResultTone("All changes applied. Ready for review?").should.containEql("ends with a question")
			should.not.exist(validateCompletionResultTone("Implemented retry logic and all tests pass."))
		})
	})

	describe("validateCompletionTaskProgress", () => {
		it("rejects incomplete task_progress checklists", () => {
			expectErrorMessage(validateCompletionTaskProgress("- [x] done\n- [ ] pending"), "task_progress")
		})
	})

	describe("validateFocusChainComplete", () => {
		it("rejects completion when focus chain has open items", () => {
			taskState.currentFocusChainChecklist = "- [x] done\n- [ ] pending"
			expectErrorMessage(validateFocusChainComplete(configWithState(taskState)), "focus chain")
		})
	})

	describe("validateCompletionAttemptCooldown", () => {
		it("throttles rapid retries after gate blocks", () => {
			taskState.completionGateBlockCount = 2
			taskState.lastCompletionAttemptAt = Date.now()
			expectErrorMessage(validateCompletionAttemptCooldown(configWithState(taskState)), "Completion throttled")
		})
	})

	describe("classifyCompletionPreflightReason", () => {
		it("maps error messages to telemetry reason codes", () => {
			classifyCompletionPreflightReason("Completion rejected: result is empty").should.equal("empty_result")
			classifyCompletionPreflightReason("Duplicate completion submission").should.equal("duplicate_submission")
			classifyCompletionPreflightReason("Completion throttled").should.equal("retry_cooldown")
			classifyCompletionPreflightReason("must not contain checklist").should.equal("checklist_in_result")
		})
	})

	describe("formatCompletionToolError", () => {
		it("wraps errors with gate status context", () => {
			const response = formatCompletionToolError("blocked", configWithState(taskState))
			response.should.containEql("blocked")
			response.should.containEql("<completion_gate_status")
		})
	})

	describe("buildCompletionPreflightRecoveryHint", () => {
		it("returns actionable guidance per preflight reason", () => {
			buildCompletionPreflightRecoveryHint("retry_cooldown").should.containEql("cooldown")
			buildCompletionPreflightRecoveryHint("focus_chain_incomplete").should.containEql("focus chain")
		})
	})

	describe("buildCompletionAgentErrorMessage", () => {
		it("includes structured status and breather hints under pressure", () => {
			taskState.completionGateBlockCount = COMPLETION_GATE_WARN_THRESHOLD
			taskState.consecutiveMistakeCount = 2
			const message = buildCompletionAgentErrorMessage("Gate blocked", configWithState(taskState))
			message.should.containEql("<completion_gate_status")
			message.should.containEql('blocks="5"')
			message.should.containEql("<completion_gate_recovery")
			message.should.containEql("Agent ergonomics")
		})

		it("includes failed_stage and recovery playbook for classified reasons", () => {
			recordCompletionBlockReason(configWithState(taskState), "result_too_long")
			const message = buildCompletionAgentErrorMessage(
				"Completion rejected: result exceeds maximum length (7000 chars, maximum 6000).",
				configWithState(taskState),
			)
			message.should.containEql('failed_stage="max_length"')
			message.should.containEql("Recovery playbook")
		})
	})

	describe("detectDuplicateCompletionSubmission", () => {
		it("blocks identical result re-submission after a gate block within cooldown", () => {
			const result = "Task complete: added retry logic"
			taskState.completionGateBlockCount = 2
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
			taskState.lastCompletionAttemptAt = Date.now()

			expectErrorMessage(
				detectDuplicateCompletionSubmission(configWithState(taskState), result),
				"Duplicate completion submission",
			)
		})

		it("allows same result after cooldown window expires", () => {
			const result = "Task complete: added retry logic"
			taskState.completionGateBlockCount = 2
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
			taskState.lastCompletionAttemptAt = Date.now() - 5000

			should.not.exist(detectDuplicateCompletionSubmission(configWithState(taskState), result))
		})

		it("allows submission when result content changed", () => {
			taskState.completionGateBlockCount = 2
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult("old result")

			should.not.exist(detectDuplicateCompletionSubmission(configWithState(taskState), "new result with fixes"))
		})

		it("allows duplicate summary when workspace checkpoint changed since gate block", () => {
			const result = "Task complete: added retry logic"
			taskState.completionGateBlockCount = 2
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
			taskState.lastGateBlockCheckpointHash = "old-hash"
			taskState.lastCompletionAttemptAt = Date.now()

			const duplicate = detectDuplicateCompletionSubmission(configWithState(taskState), result, {
				currentCheckpointHash: "new-hash",
			})
			should.not.exist(duplicate)
		})
	})

	describe("recordCompletionAttemptTime", () => {
		it("increments completionAttemptCount", () => {
			recordCompletionAttemptTime(configWithState(taskState))
			;(taskState.completionAttemptCount ?? 0).should.equal(1)
			recordCompletionAttemptTime(configWithState(taskState))
			;(taskState.completionAttemptCount ?? 0).should.equal(2)
		})
	})

	describe("getLatestCheckpointHashFromMessages", () => {
		it("returns the most recent checkpoint hash from messages", () => {
			const config = {
				taskState,
				messageState: {
					getDietCodeMessages: () => [{ say: "checkpoint_created" }, { lastCheckpointHash: "abc123" }],
				},
			} as TaskConfig
			getLatestCheckpointHashFromMessages(config).should.equal("abc123")
		})
	})

	describe("hashCompletionResult", () => {
		it("is stable for trimmed-equivalent input", () => {
			hashCompletionResult("hello").should.equal(hashCompletionResult("  hello  "))
		})
	})

	describe("completion gate retry guidance", () => {
		it("adds progressive guidance as block count increases", () => {
			buildCompletionGateRetryGuidance(1).should.equal("")
			buildCompletionGateRetryGuidance(2).should.containEql("Repeated completion gate block")
			buildCompletionGateRetryGuidance(COMPLETION_GATE_WARN_THRESHOLD).should.containEql("Completion gate pressure")
		})

		it("appends guidance to gate block messages", () => {
			const message = appendCompletionGateRetryGuidance("blocked", 3)
			message.should.containEql("blocked")
			message.should.containEql("Repeated completion gate block")
		})
	})

	describe("buildDoubleCheckReverifyMessage", () => {
		it("includes numbered verification steps and optional sections", () => {
			const message = buildDoubleCheckReverifyMessage({
				taskSection: "\n\n<initial_task>\nfix bug\n</initial_task>",
				auditPreviewSection: "\n\n<audit_preview />",
			})
			message.should.containEql("1. All requested changes have been made")
			message.should.containEql("<initial_task>")
			message.should.containEql("<audit_preview />")
			message.should.containEql("call attempt_completion again")
		})
	})

	describe("recordCompletionGateBlock", () => {
		it("increments and returns the block count", () => {
			recordCompletionGateBlock(configWithState(taskState)).should.equal(1)
			recordCompletionGateBlock(configWithState(taskState)).should.equal(2)
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
