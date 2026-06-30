import { beforeEach, describe, it } from "mocha"
import "should"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { TaskState } from "../../../TaskState"
import {
	detectDuplicateCompletionSubmission,
	getCompletionCooldownRemainingMs,
	getCompletionGateCircuitBreakerError,
	getCompletionGraphRevision,
	hashCompletionResult,
	incrementCompletionGraphRevision,
	isCompletionGateCircuitBreakerTripped,
	recordCompletionGateBlockEvent,
	validateWorkspaceProgressSinceGateBlock,
} from "../../attemptCompletionUtils"
import type { TaskConfig } from "../../types/TaskConfig"

function configWithState(taskState: TaskState, messages: Array<{ lastCheckpointHash?: string }> = []): TaskConfig {
	return {
		taskState,
		focusChainSettings: { enabled: false },
		messageState: {
			getDietCodeMessages: () => messages,
		},
	} as unknown as TaskConfig
}

describe("false-positive prevention and infinite-loop elimination", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("circuit breaker half-open probe state", () => {
		it("trips when block count reaches max and workspace unchanged", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.lastGateBlockCheckpointHash = "chk-1"
			// No messages with checkpoint hash — no change detected
			isCompletionGateCircuitBreakerTripped(config).should.be.true()
		})

		it("opens for a probe attempt when workspace changed and engineering not verified", () => {
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-new" }])
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.lastGateBlockCheckpointHash = "chk-old"
			// Workspace changed — circuit breaker opens for one probe
			isCompletionGateCircuitBreakerTripped(config).should.be.false()
		})

		it("stays tripped when workspace changed but engineering is verified (use finalization)", () => {
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-new" }])
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.lastGateBlockCheckpointHash = "chk-old"
			taskState.engineeringVerifiedAt = Date.now()
			// Engineering verified — circuit breaker stays tripped, use run_finalization
			isCompletionGateCircuitBreakerTripped(config).should.be.true()
		})

		it("circuit breaker message guides to workspace changes when not verified", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.lastGateBlockCheckpointHash = "chk-1"
			const message = getCompletionGateCircuitBreakerError(config)
			should.exist(message)
			message?.should.containEql("checkpoint hash must change")
			message?.should.containEql("probe attempt")
		})

		it("circuit breaker message guides to run_finalization when verified", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.engineeringVerifiedAt = Date.now()
			const message = getCompletionGateCircuitBreakerError(config)
			should.exist(message)
			message?.should.containEql("run_finalization")
			message?.should.containEql("seal=true")
		})
	})

	describe("workspace progress preflight prevents audit loop", () => {
		it("blocks when workspace unchanged since last gate block", () => {
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-1" }])
			taskState.completionGateBlockCount = 2
			taskState.lastGateBlockCheckpointHash = "chk-1"
			const error = validateWorkspaceProgressSinceGateBlock(config, "chk-1")
			should.exist(error)
			error?.should.containEql("workspace hasn't changed")
		})

		it("allows when workspace changed since last gate block", () => {
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-new" }])
			taskState.completionGateBlockCount = 2
			taskState.lastGateBlockCheckpointHash = "chk-old"
			const error = validateWorkspaceProgressSinceGateBlock(config, "chk-new")
			should.not.exist(error)
		})

		it("allows when no blocks have occurred", () => {
			const config = configWithState(taskState)
			const error = validateWorkspaceProgressSinceGateBlock(config, "chk-1")
			should.not.exist(error)
		})

		it("allows when engineering is verified (finalization lane handles it)", () => {
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-1" }])
			taskState.completionGateBlockCount = 2
			taskState.lastGateBlockCheckpointHash = "chk-1"
			taskState.engineeringVerifiedAt = Date.now()
			const error = validateWorkspaceProgressSinceGateBlock(config, "chk-1")
			should.not.exist(error)
		})

		it("allows when no prior checkpoint hash recorded", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = 2
			// lastGateBlockCheckpointHash is undefined
			const error = validateWorkspaceProgressSinceGateBlock(config, "chk-1")
			should.not.exist(error)
		})
	})

	describe("duplicate submission prevents retry thrashing after cooldown", () => {
		it("blocks identical result after cooldown with no workspace change", () => {
			const result = "Implemented the feature with tests and verification"
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = 3
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
			taskState.lastCompletionAttemptAt = Date.now() - 10000
			// Cooldown expired, but workspace unchanged — block to prevent loop
			const error = detectDuplicateCompletionSubmission(config, result)
			should.exist(error)
			error?.should.containEql("no workspace changes")
		})

		it("directs to run_finalization when engineering verified and workspace unchanged", () => {
			const result = "Implemented the feature with tests and verification"
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = 3
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
			taskState.lastCompletionAttemptAt = Date.now() - 10000
			taskState.engineeringVerifiedAt = Date.now()
			const error = detectDuplicateCompletionSubmission(config, result)
			should.exist(error)
			error?.should.containEql("run_finalization")
		})

		it("allows when workspace changed even with identical result", () => {
			const result = "Implemented the feature with tests and verification"
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-new" }])
			taskState.completionGateBlockCount = 3
			taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
			taskState.lastCompletionAttemptAt = Date.now() - 10000
			taskState.lastGateBlockCheckpointHash = "chk-old"
			const error = detectDuplicateCompletionSubmission(config, result, {
				currentCheckpointHash: "chk-new",
			})
			should.not.exist(error)
		})
	})

	describe("graph revision guards prevent stale audit false positives", () => {
		it("graph revision increments on gate block event", () => {
			const config = configWithState(taskState)
			const before = getCompletionGraphRevision(config)
			recordCompletionGateBlockEvent(config, "audit_gate", { result: "test result" })
			getCompletionGraphRevision(config).should.be.greaterThan(before)
		})

		it("stale audit graph revision is detectable via mismatch", () => {
			const config = configWithState(taskState)
			// Simulate audit cached at revision 1
			taskState.lastCompletionAuditGraphRevision = 1
			// Simulate a gate block that incremented the revision to 2
			incrementCompletionGraphRevision(config)
			incrementCompletionGraphRevision(config)
			const currentRevision = getCompletionGraphRevision(config)
			currentRevision.should.equal(2)
			// The audit's revision (1) doesn't match current (2) — stale
			const revisionMatches = taskState.lastCompletionAuditGraphRevision === currentRevision
			revisionMatches.should.be.false()
		})
	})

	describe("single-session completion escape routes", () => {
		it("circuit breaker with verified engineering allows finalization, not new sessions", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.engineeringVerifiedAt = Date.now()
			const message = getCompletionGateCircuitBreakerError(config)
			should.exist(message)
			// Must NOT suggest creating a new session or new task
			message?.should.not.match(/new session/i)
			message?.should.not.match(/new task/i)
			// Must guide to same-session finalization
			message?.should.containEql("run_finalization")
			message?.should.containEql("seal=true")
		})

		it("circuit breaker without verified engineering provides probe attempt path", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.lastGateBlockCheckpointHash = "chk-1"
			const message = getCompletionGateCircuitBreakerError(config)
			should.exist(message)
			// Must NOT suggest new session
			message?.should.not.match(/new session/i)
			// Must provide the probe attempt escape route
			message?.should.containEql("probe attempt")
			message?.should.containEql("checkpoint hash must change")
		})

		it("cooldown remains bounded — no unbounded wait", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT - 1
			taskState.lastCompletionAttemptAt = Date.now()
			const cooldown = getCompletionCooldownRemainingMs(config)
			cooldown.should.be.lessThanOrEqual(30000)
		})
	})
})
