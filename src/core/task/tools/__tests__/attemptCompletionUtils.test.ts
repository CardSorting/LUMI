import type { ToolUse } from "@core/assistant-message"
import { beforeEach, describe, it } from "mocha"
import "should"
import {
	COMPLETION_GATE_BLOCK_HISTORY_MAX,
	COMPLETION_GATE_STATUS_SCHEMA_VERSION,
	COMPLETION_GATE_WARN_THRESHOLD,
	COMPLETION_RESULT_MAX_LENGTH,
	MAX_COMPLETION_GATE_BLOCK_COUNT,
} from "@shared/audit/gatePolicy"
import { DietCodeDefaultTool } from "@shared/tools"
import { TaskState } from "../../TaskState"
import {
	appendCompletionGateBlockHistory,
	appendCompletionGateRetryGuidance,
	buildCompletionAgentErrorMessage,
	buildCompletionGateActionBlock,
	buildCompletionGateAgentEnvelope,
	buildCompletionGateDigestBlock,
	buildCompletionGateEscalationBrief,
	buildCompletionGateFocusBlock,
	buildCompletionGateHealthBlock,
	buildCompletionGateHistoryBlock,
	buildCompletionGateHumanBrief,
	buildCompletionGateNextStagesBlock,
	buildCompletionGateObservabilityEnvelope,
	buildCompletionGatePassedBrief,
	buildCompletionGatePassedEnvelope,
	buildCompletionGatePipelineBrief,
	buildCompletionGatePlaybook,
	buildCompletionGatePlaybookBlock,
	buildCompletionGateProblemBlock,
	buildCompletionGateRateLimitBlock,
	buildCompletionGateReadinessBlock,
	buildCompletionGateRecoveryBlock,
	buildCompletionGateRetryGuidance,
	buildCompletionGateStageProgressBlock,
	buildCompletionGateStateBlock,
	buildCompletionGateStructuredContext,
	buildCompletionGateWorkspaceBlock,
	buildCompletionPreflightReadinessBrief,
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
	getCompletionGateOperationalState,
	getCompletionGatePressureLevel,
	getCompletionGateRetryPolicy,
	getCompletionGateTelemetryContext,
	getCompletionRetryCooldownMs,
	getLatestCheckpointHashFromMessages,
	getOrCreateCompletionGateSessionId,
	getRemainingCompletionGateStages,
	hashCompletionResult,
	isCompletionGateCircuitBreakerTripped,
	mapCompletionReasonToHttpStatus,
	mapCompletionReasonToPreflightStage,
	markCompletionAttemptFinished,
	markCompletionGatesPassed,
	markPreflightReadinessHintEmitted,
	markProactiveCompletionGuidanceEmitted,
	recordCompletionAttemptTime,
	recordCompletionBlockReason,
	recordCompletionGateBlock,
	recordCompletionGateBlockEvent,
	resolveCompletionBlockReason,
	shouldEmitPreflightReadinessHint,
	shouldEmitProactiveCompletionGuidance,
	shouldRejectDoubleCheckCompletion,
	syncCompletionGateObservabilityCache,
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
	} as unknown as TaskConfig
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
			taskState.consecutiveMistakeCount.should.equal(0)

			const toolError = checkCompletionGateCircuitBreaker(config)
			should.exist(toolError)
			if (toolError === null) {
				throw new Error("expected circuit breaker tool error")
			}
			toolError.should.containEql("Task completion blocked")
			taskState.consecutiveMistakeCount.should.equal(1)
			taskState.lastCompletionBlockReason!.should.equal("circuit_breaker")
			taskState.lastCompletionFailedStage!.should.equal("circuit_breaker")
			taskState.completionGatePressureLevel!.should.equal("tripped")
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
			mapCompletionReasonToPreflightStage("task_progress_required").should.equal("task_progress_required")
			mapCompletionReasonToPreflightStage("task_progress_align").should.equal("task_progress_align")
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
			buildCompletionGatePlaybook("circuit_breaker").should.containEql("Stop calling attempt_completion")
		})
	})

	describe("buildCompletionGatePlaybookBlock", () => {
		it("emits machine-parseable playbook XML", () => {
			const block = buildCompletionGatePlaybookBlock("retry_cooldown")
			block.should.containEql('<completion_gate_playbook reason="retry_cooldown"')
			block.should.containEql('<step order="1">')
		})
	})

	describe("buildCompletionGatePipelineBrief", () => {
		it("lists pipeline stages and highlights failed stage", () => {
			buildCompletionGatePipelineBrief("quality").should.containEql("Gate pipeline")
			buildCompletionGatePipelineBrief("quality").should.containEql("Failed at: `quality`")
		})
	})

	describe("getCompletionGateRetryPolicy", () => {
		it("marks circuit breaker as non-retryable", () => {
			const policy = getCompletionGateRetryPolicy("circuit_breaker", configWithState(taskState))
			policy.retryable.should.be.false()
			policy.retryStatus.should.equal("blocked")
		})

		it("returns wait status while cooldown is active", () => {
			taskState.completionGateBlockCount = 2
			taskState.lastCompletionAttemptAt = Date.now()
			const policy = getCompletionGateRetryPolicy("retry_cooldown", configWithState(taskState))
			policy.retryable.should.be.false()
			policy.retryStatus.should.equal("wait")
			policy.retryAfterMs.should.be.greaterThan(0)
		})
	})

	describe("resolveCompletionBlockReason", () => {
		it("prefers recorded reason over message classification", () => {
			recordCompletionBlockReason(configWithState(taskState), "audit_gate")
			resolveCompletionBlockReason("Completion rejected: result is empty", configWithState(taskState)).should.equal(
				"audit_gate",
			)
		})
	})

	describe("getRemainingCompletionGateStages", () => {
		it("returns downstream stages after a failure", () => {
			const remaining = getRemainingCompletionGateStages("quality")
			remaining.should.containEql("checklist_in_result")
			remaining.should.containEql("audit")
		})
	})

	describe("buildCompletionGatePassedBrief", () => {
		it("emits passed status with score", () => {
			buildCompletionGatePassedBrief(configWithState(taskState), 82).should.containEql('passed="true"')
			buildCompletionGatePassedBrief(configWithState(taskState), 82).should.containEql('score="82"')
		})
	})

	describe("buildCompletionGateProblemBlock", () => {
		it("emits RFC 7807-style problem XML", () => {
			const block = buildCompletionGateProblemBlock(
				"result_too_brief",
				"Completion rejected: result is too brief",
				configWithState(taskState),
			)
			block.should.containEql("<completion_gate_problem")
			block.should.containEql(`schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}"`)
			block.should.containEql('type="result_too_brief"')
			block.should.containEql('stage="min_length"')
			block.should.containEql('instance="completion-gate/min_length"')
			block.should.containEql('http_status="422"')
			block.should.containEql('soft="false"')
		})
	})

	describe("buildCompletionGateAgentEnvelope", () => {
		it("wraps structured blocks in a single envelope", () => {
			const envelope = buildCompletionGateAgentEnvelope([
				buildCompletionGateHealthBlock(configWithState(taskState)),
				'<stage name="quality" status="failed" />',
			])
			envelope.should.containEql("<completion_gate_envelope")
			envelope.should.containEql("<completion_gate_health")
		})
	})

	describe("buildCompletionGateStageProgressBlock", () => {
		it("marks failed stage and downstream skipped stages", () => {
			const block = buildCompletionGateStageProgressBlock("quality")
			block.should.containEql('<stage name="quality" status="failed"')
			block.should.containEql('<stage name="checklist_in_result" status="skipped"')
		})
	})

	describe("getCompletionGatePressureLevel", () => {
		it("escalates pressure as block count increases", () => {
			getCompletionGatePressureLevel(configWithState(taskState)).should.equal("stable")
			taskState.completionGateBlockCount = 3
			getCompletionGatePressureLevel(configWithState(taskState)).should.equal("elevated")
			taskState.completionGateBlockCount = COMPLETION_GATE_WARN_THRESHOLD
			getCompletionGatePressureLevel(configWithState(taskState)).should.equal("critical")
		})
	})

	describe("getCompletionGateOperationalState", () => {
		it("returns tripped when block budget is exhausted", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			getCompletionGateOperationalState(configWithState(taskState)).should.equal("tripped")
		})

		it("returns wait while cooldown is active", () => {
			taskState.completionGateBlockCount = 1
			taskState.lastCompletionAttemptAt = Date.now()
			getCompletionGateOperationalState(configWithState(taskState)).should.equal("wait")
		})
	})

	describe("buildCompletionGateStateBlock", () => {
		it("emits operational state with session id", () => {
			recordCompletionBlockReason(configWithState(taskState), "audit_gate")
			const block = buildCompletionGateStateBlock(configWithState(taskState))
			block.should.containEql("<completion_gate_state")
			block.should.containEql('state="ready"')
		})
	})

	describe("buildCompletionGateNextStagesBlock", () => {
		it("lists downstream stages with hints", () => {
			recordCompletionBlockReason(configWithState(taskState), "result_too_long")
			const block = buildCompletionGateNextStagesBlock(configWithState(taskState))
			block.should.containEql("<completion_gate_next_stages")
			block.should.containEql('failed_at="max_length"')
		})
	})

	describe("buildCompletionGateFocusBlock", () => {
		it("reports focus chain completion progress", () => {
			const config = {
				...configWithState(taskState),
				focusChainSettings: { enabled: true },
				taskState,
			} as TaskConfig
			taskState.currentFocusChainChecklist = "- [x] one\n- [ ] two"
			const block = buildCompletionGateFocusBlock(config)
			block.should.containEql("<completion_gate_focus")
			block.should.containEql('total="2"')
			block.should.containEql('complete="false"')
		})
	})

	describe("buildCompletionGateReadinessBlock", () => {
		it("marks ready when no issues are present", () => {
			buildCompletionGateReadinessBlock([]).should.containEql('ready="true"')
		})

		it("lists dry-run issues with stage and http status", () => {
			const block = buildCompletionGateReadinessBlock([
				{ stage: "min_length", message: "Completion rejected: result is too brief" },
			])
			block.should.containEql('ready="false"')
			block.should.containEql('stage="min_length"')
			block.should.containEql('http_status="422"')
		})

		it("keeps ready true when only info advisories are present", () => {
			const block = buildCompletionGateReadinessBlock([
				{
					stage: "roadmap",
					message: "Governance runs automatically at attempt_completion — continue the task.",
					severity: "info",
				},
			])
			block.should.containEql('ready="true"')
			block.should.containEql('advisory_count="1"')
			block.should.containEql("<advisory")
			block.should.containEql('governance_policy="')
		})
	})

	describe("isCompletionGateCircuitBreakerTripped", () => {
		it("detects tripped breaker without mutating state", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			isCompletionGateCircuitBreakerTripped(configWithState(taskState)).should.be.true()
			should.not.exist(taskState.lastCompletionBlockReason)
		})
	})

	describe("mapCompletionReasonToHttpStatus", () => {
		it("maps block reasons to HTTP status analogues", () => {
			mapCompletionReasonToHttpStatus("retry_cooldown").should.equal(429)
			mapCompletionReasonToHttpStatus("duplicate_submission").should.equal(409)
			mapCompletionReasonToHttpStatus("circuit_breaker").should.equal(403)
			mapCompletionReasonToHttpStatus("audit_error").should.equal(503)
			mapCompletionReasonToHttpStatus("double_check").should.equal(428)
			mapCompletionReasonToHttpStatus("result_too_long").should.equal(422)
		})
	})

	describe("buildCompletionGateRateLimitBlock", () => {
		it("emits limit/remaining/reset when blocks exist", () => {
			taskState.completionGateBlockCount = 2
			taskState.lastCompletionAttemptAt = Date.now()
			const block = buildCompletionGateRateLimitBlock(configWithState(taskState))
			block.should.containEql("<completion_gate_rate_limit")
			block.should.containEql(`limit="${MAX_COMPLETION_GATE_BLOCK_COUNT}"`)
			block.should.containEql('remaining="8"')
		})
	})

	describe("buildCompletionGateWorkspaceBlock", () => {
		it("reports checkpoint delta since last gate block", () => {
			taskState.lastGateBlockCheckpointHash = "abc"
			const config = {
				...configWithState(taskState),
				messageState: {
					getDietCodeMessages: () => [{ lastCheckpointHash: "def" }],
				},
			} as TaskConfig
			const block = buildCompletionGateWorkspaceBlock(config)
			block.should.containEql("<completion_gate_workspace")
			block.should.containEql('changed="true"')
		})
	})

	describe("buildCompletionGateHumanBrief", () => {
		it("returns a scannable one-line routing summary", () => {
			recordCompletionBlockReason(configWithState(taskState), "audit_gate")
			taskState.completionGateBlockCount = 2
			const brief = buildCompletionGateHumanBrief(configWithState(taskState))
			brief.should.containEql("Gate block")
			brief.should.containEql("`audit_gate`")
			brief.should.containEql("HTTP 422")
		})
	})

	describe("getOrCreateCompletionGateSessionId", () => {
		it("creates a stable session id for the completion cycle", () => {
			const config = configWithState(taskState)
			const first = getOrCreateCompletionGateSessionId(config)
			const second = getOrCreateCompletionGateSessionId(config)
			first.should.equal(second)
			first.length.should.equal(12)
		})
	})

	describe("buildCompletionGateStructuredContext", () => {
		it("returns a unified envelope for gate errors", () => {
			taskState.completionGateBlockCount = 1
			taskState.lastGateBlockCheckpointHash = "prior"
			recordCompletionBlockReason(configWithState(taskState), "result_too_long")
			const config = {
				...configWithState(taskState),
				messageState: {
					getDietCodeMessages: () => [{ lastCheckpointHash: "current" }],
				},
			} as TaskConfig
			const context = buildCompletionGateStructuredContext("Completion rejected: result exceeds maximum length", config)
			context.should.containEql("<completion_gate_envelope")
			context.should.containEql("<completion_gate_stages")
			context.should.containEql("<completion_gate_problem")
			context.should.containEql("<completion_gate_digest")
			context.should.containEql("<completion_gate_history")
			context.should.containEql("<completion_gate_state")
			context.should.containEql("<completion_gate_next_stages")
			context.should.containEql("<completion_gate_rate_limit")
			context.should.containEql("<completion_gate_workspace")
			context.should.containEql("<completion_gate_action")
		})
	})

	describe("buildCompletionGateDigestBlock", () => {
		it("summarizes routing attributes for the latest block reason", () => {
			recordCompletionBlockReason(configWithState(taskState), "result_too_long")
			const digest = buildCompletionGateDigestBlock(configWithState(taskState))
			digest.should.containEql("<completion_gate_digest")
			digest.should.containEql('reason="result_too_long"')
			digest.should.containEql('stage="max_length"')
			digest.should.containEql('operational_state="ready"')
		})

		it("includes operational_state when circuit breaker is tripped", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			const digest = buildCompletionGateDigestBlock(configWithState(taskState))
			digest.should.containEql('operational_state="tripped"')
		})
	})

	describe("buildCompletionGateObservabilityEnvelope", () => {
		it("includes playbook and problem detail when a block reason exists", () => {
			recordCompletionBlockReason(configWithState(taskState), "result_too_long")
			const envelope = buildCompletionGateObservabilityEnvelope(configWithState(taskState))
			envelope.should.containEql("<completion_gate_envelope")
			envelope.should.containEql("<completion_gate_playbook")
			envelope.should.containEql("<completion_gate_problem")
			envelope.should.containEql('reason="result_too_long"')
			envelope.should.containEql("Shorten the result")
		})
	})

	describe("buildCompletionGateHistoryBlock", () => {
		it("retains a ring buffer of recent gate block events", () => {
			const config = configWithState(taskState)
			recordCompletionBlockReason(config, "empty_result")
			recordCompletionBlockReason(config, "audit_gate")
			const block = buildCompletionGateHistoryBlock(config)
			block.should.containEql("<completion_gate_history")
			block.should.containEql('count="2"')
			block.should.containEql('reason="audit_gate"')
		})
	})

	describe("appendCompletionGateBlockHistory", () => {
		it("caps history at COMPLETION_GATE_BLOCK_HISTORY_MAX entries", () => {
			const config = configWithState(taskState)
			for (let i = 0; i < COMPLETION_GATE_BLOCK_HISTORY_MAX + 2; i++) {
				appendCompletionGateBlockHistory(config, "retry_cooldown")
			}
			should.exist(config.taskState.completionGateBlockHistory)
			config.taskState.completionGateBlockHistory?.length.should.equal(COMPLETION_GATE_BLOCK_HISTORY_MAX)
		})
	})

	describe("buildCompletionGateActionBlock", () => {
		it("emits a dedicated next-action block with retry policy", () => {
			const block = buildCompletionGateActionBlock("result_too_long", configWithState(taskState))
			block.should.containEql("<completion_gate_action")
			block.should.containEql('reason="result_too_long"')
			block.should.containEql('retry_status="ready"')
		})
	})

	describe("buildCompletionGatePassedEnvelope", () => {
		it("wraps passed status with all-green stage progress", () => {
			const envelope = buildCompletionGatePassedEnvelope(configWithState(taskState), 91)
			envelope.should.containEql("<completion_gate_envelope")
			envelope.should.containEql('outcome="passed"')
			envelope.should.containEql('passed="true"')
			envelope.should.containEql('score="91"')
		})
	})

	describe("syncCompletionGateObservabilityCache", () => {
		it("persists envelope on task state after block reason is recorded", () => {
			recordCompletionBlockReason(configWithState(taskState), "audit_gate")
			should.exist(taskState.completionGateObservabilityEnvelope)
			taskState.completionGateObservabilityEnvelope?.should.containEql("<completion_gate_envelope")
			syncCompletionGateObservabilityCache(configWithState(taskState))
			taskState.completionGateObservabilityEnvelope?.should.containEql('reason="audit_gate"')
		})
	})

	describe("getCompletionGateTelemetryContext", () => {
		it("returns pressure, retry status, failed stage, and session id", () => {
			recordCompletionBlockReason(configWithState(taskState), "retry_cooldown")
			recordCompletionAttemptTime(configWithState(taskState))
			const ctx = getCompletionGateTelemetryContext(configWithState(taskState))
			ctx.pressureLevel.should.equal("stable")
			should.exist(ctx.failedStage)
			ctx.failedStage?.should.equal("cooldown")
			should.exist(ctx.sessionId)
		})
	})

	describe("preflight readiness hint", () => {
		it("emits once when audit preview exists and no prior blocks", () => {
			const config = {
				...configWithState(taskState),
				auditCompletionGateEnabled: true,
				taskState,
			} as TaskConfig
			taskState.lastAdvisoryAudit = { hardening_score: 70, violations: [] }
			shouldEmitPreflightReadinessHint(config).should.be.true()
			markPreflightReadinessHintEmitted(config)
			shouldEmitPreflightReadinessHint(config).should.be.false()
		})

		it("includes pipeline stages in readiness brief", () => {
			const brief = buildCompletionPreflightReadinessBrief(configWithState(taskState))
			brief.should.containEql("Gate pipeline")
			brief.should.containEql("<completion_gate_envelope")
			brief.should.containEql("<completion_gate_health")
		})
	})

	describe("recordCompletionGateBlockEvent", () => {
		it("increments block count, records reason, fingerprint, and block timestamp", () => {
			recordCompletionGateBlockEvent(configWithState(taskState), "result_too_brief", {
				result: "too short",
				checkpointHash: "abc",
			})
			taskState.completionGateBlockCount!.should.equal(1)
			taskState.lastCompletionBlockReason!.should.equal("result_too_brief")
			taskState.lastCompletionFailedStage!.should.equal("min_length")
			taskState.completionGatePressureLevel!.should.equal("stable")
			should.exist(taskState.lastCompletionAttemptAt)
			should.exist(taskState.lastBlockedCompletionResultFingerprint)
			taskState.lastGateBlockCheckpointHash!.should.equal("abc")
		})

		it("does not increment block count for circuit breaker", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			recordCompletionGateBlockEvent(configWithState(taskState), "circuit_breaker")
			taskState.completionGateBlockCount.should.equal(MAX_COMPLETION_GATE_BLOCK_COUNT)
			taskState.lastCompletionBlockReason!.should.equal("circuit_breaker")
		})

		it("does not increment block count for soft throttle blocks", () => {
			recordCompletionGateBlockEvent(configWithState(taskState), "retry_cooldown")
			;(taskState.completionGateBlockCount ?? 0).should.equal(0)
			taskState.lastCompletionBlockReason!.should.equal("retry_cooldown")
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
			const guidance = buildProactiveCompletionGuidance(configWithState(taskState))
			guidance.should.containEql("Completion gate advisory")
			guidance.should.containEql("<completion_gate_envelope")
		})

		it("records block reason, failed stage, and pressure on the task state", () => {
			recordCompletionBlockReason(configWithState(taskState), "retry_cooldown")
			taskState.lastCompletionBlockReason!.should.equal("retry_cooldown")
			taskState.lastCompletionFailedStage!.should.equal("cooldown")
			taskState.completionGatePressureLevel!.should.equal("stable")
		})
	})

	describe("getCompletionRetryCooldownMs", () => {
		it("applies exponential backoff capped at max", () => {
			getCompletionRetryCooldownMs(1).should.equal(1200)
			getCompletionRetryCooldownMs(2).should.equal(2400)
			getCompletionRetryCooldownMs(5).should.equal(19200)
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

		it("clears doubleCheckCompletionPending, gate block count, history, session, and fingerprint after a finished attempt", () => {
			taskState.doubleCheckCompletionPending = true
			taskState.completionGateBlockCount = 4
			taskState.lastBlockedCompletionResultFingerprint = "abc123"
			taskState.completionGateSessionId = "session123456"
			taskState.completionGateBlockHistory = [{ reason: "audit_gate", stage: "audit", at: 1, soft: false, blockCount: 4 }]
			markCompletionAttemptFinished(configWithState(taskState))
			taskState.doubleCheckCompletionPending.should.be.false()
			taskState.completionGateBlockCount.should.equal(0)
			should.not.exist(taskState.lastBlockedCompletionResultFingerprint)
			should.not.exist(taskState.completionGateBlockHistory)
			should.not.exist(taskState.completionGateSessionId)
		})
	})

	describe("validateCompletionResultQuality", () => {
		it("rejects empty and placeholder-marked results", () => {
			validateCompletionResultQuality("   ")!.should.containEql("empty")
			validateCompletionResultQuality("Done but TODO: fix tests")!.should.containEql("unfinished markers")
			should.not.exist(validateCompletionResultQuality("All tests pass and feature is complete."))
		})
	})

	describe("validateCompletionResultTone", () => {
		it("rejects question endings and engagement bait", () => {
			validateCompletionResultTone("All done.\nLet me know if you need anything else")!.should.containEql("solicits")
			validateCompletionResultTone("All changes applied. Ready for review?")!.should.containEql("ends with a question")
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
			classifyCompletionPreflightReason("task_progress is required when").should.equal("task_progress_required")
			classifyCompletionPreflightReason("task_progress has 1 item(s) but focus chain has 3").should.equal(
				"task_progress_align",
			)
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

		it("routes circuit breaker recovery to same-session finalization", () => {
			const hint = buildCompletionPreflightRecoveryHint("circuit_breaker")
			hint.should.containEql("run_finalization")
			hint.should.not.match(/new task/i)
			hint.should.not.match(/new session/i)
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
			message.should.containEql("Reconciliation")
		})

		it("includes failed_stage and recovery playbook for classified reasons", () => {
			recordCompletionBlockReason(configWithState(taskState), "result_too_long")
			const message = buildCompletionAgentErrorMessage(
				"Completion rejected: result exceeds maximum length (7000 chars, maximum 6000).",
				configWithState(taskState),
			)
			message.should.containEql('failed_stage="max_length"')
			message.should.containEql("Gate block")
			message.should.containEql("<completion_gate_envelope")
			message.should.containEql("<completion_gate_problem")
			message.should.containEql("<completion_gate_playbook")
			message.should.containEql('retry_status="ready"')
			message.should.containEql('retryable="true"')
			message.should.containEql('retry_after_ms="')
			message.should.containEql('remaining_stages="')
			message.should.containEql("Recovery playbook")
			message.should.containEql('next_action="')
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
			} as unknown as TaskConfig
			getLatestCheckpointHashFromMessages(config)!.should.equal("abc123")
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
