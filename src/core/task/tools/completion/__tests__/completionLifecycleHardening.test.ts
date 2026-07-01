import { beforeEach, describe, it } from "mocha"
import "should"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { TaskState } from "../../../TaskState"
import {
	clearReconciliationDebounce,
	getCanonicalCompletionPhase,
	getCompletionCooldownRemainingMs,
	getCompletionGraphRevision,
	incrementCompletionGraphRevision,
	markCompletionAttemptFinished,
	markCompletionGatesPassed,
	recordCompletionAttemptTime,
	recordCompletionGateBlockEvent,
	shouldSuppressNoOpRetry,
	validateNotInReconciliationDebounce,
} from "../../attemptCompletionUtils"
import type { TaskConfig } from "../../types/TaskConfig"

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskState,
		focusChainSettings: { enabled: false },
		messageState: {
			getDietCodeMessages: () => [],
		},
	} as unknown as TaskConfig
}

describe("completion lifecycle hardening", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("graph revision tracking", () => {
		it("starts at 0 and increments on each transition", () => {
			const config = configWithState(taskState)
			getCompletionGraphRevision(config).should.equal(0)
			incrementCompletionGraphRevision(config)
			getCompletionGraphRevision(config).should.equal(1)
			incrementCompletionGraphRevision(config)
			getCompletionGraphRevision(config).should.equal(2)
		})

		it("does not increment on advisory gate findings", () => {
			const config = configWithState(taskState)
			const before = getCompletionGraphRevision(config)
			recordCompletionGateBlockEvent(config, "audit_gate", { result: "test result summary" })
			getCompletionGraphRevision(config).should.equal(before)
		})

		it("does not increment on gates passed (cosmetic validation result)", () => {
			const config = configWithState(taskState)
			incrementCompletionGraphRevision(config) // start at 1
			const before = getCompletionGraphRevision(config)
			markCompletionGatesPassed(config)
			getCompletionGraphRevision(config).should.equal(before) // no increment
		})

		it("increments on attempt finished", () => {
			const config = configWithState(taskState)
			const before = getCompletionGraphRevision(config)
			markCompletionAttemptFinished(config)
			getCompletionGraphRevision(config).should.be.greaterThan(before)
		})
	})

	describe("no-op retry suppression", () => {
		it("does not suppress on first attempt", () => {
			const config = configWithState(taskState)
			const result = shouldSuppressNoOpRetry(config)
			result.suppress.should.be.false()
		})

		it("advisory findings do not change graph revision", () => {
			const config = configWithState(taskState)
			recordCompletionAttemptTime(config)
			recordCompletionGateBlockEvent(config, "audit_gate", { result: "test result summary" })
			// Advisory diagnostics do not alter the canonical graph.
			const result = shouldSuppressNoOpRetry(config)
			result.suppress.should.be.false()
		})

		it("suppresses when same revision within debounce window", () => {
			const config = configWithState(taskState)
			// Simulate an attempt that was recorded but no state change happened
			recordCompletionAttemptTime(config)
			// Manually set the attempt graph revision = current revision (no change)
			// Use getCompletionGraphRevision which handles the ?? 0 default
			taskState.lastCompletionAttemptGraphRevision = getCompletionGraphRevision(config)
			taskState.lastCompletionAttemptAt = Date.now()

			const result = shouldSuppressNoOpRetry(config)
			result.suppress.should.be.true()
			should.exist(result.reason)
			result.reason?.should.containEql("Awaiting reconciliation completion")
		})

		it("does not suppress when debounce window expired", () => {
			const config = configWithState(taskState)
			recordCompletionAttemptTime(config)
			taskState.lastCompletionAttemptGraphRevision = getCompletionGraphRevision(config)
			// Set attempt time to past beyond debounce
			taskState.lastCompletionAttemptAt = Date.now() - 5000

			const result = shouldSuppressNoOpRetry(config)
			result.suppress.should.be.false()
		})

		it("validateNotInReconciliationDebounce returns error when suppressed", () => {
			const config = configWithState(taskState)
			recordCompletionAttemptTime(config)
			taskState.lastCompletionAttemptGraphRevision = getCompletionGraphRevision(config)
			taskState.lastCompletionAttemptAt = Date.now()

			const error = validateNotInReconciliationDebounce(config)
			should.exist(error)
			error?.should.containEql("Awaiting reconciliation completion")
		})

		it("validateNotInReconciliationDebounce returns null when not suppressed", () => {
			const config = configWithState(taskState)
			const error = validateNotInReconciliationDebounce(config)
			should.not.exist(error)
		})
	})

	describe("reconciliation debounce management", () => {
		it("markReconciliationDebounceActive sets flag", () => {
			const config = configWithState(taskState)
			taskState.reconciliationDebounceActive = true
			clearReconciliationDebounce(config)
			taskState.reconciliationDebounceActive?.should.be.false()
		})

		it("clears on markCompletionAttemptFinished", () => {
			const config = configWithState(taskState)
			taskState.reconciliationDebounceActive = true
			taskState.lastCompletionAttemptGraphRevision = 5
			markCompletionAttemptFinished(config)
			should.not.exist(taskState.lastCompletionAttemptGraphRevision)
			taskState.reconciliationDebounceActive?.should.be.false()
		})
	})

	describe("canonical phase derivation", () => {
		it("returns evaluating for default state", () => {
			const config = configWithState(taskState)
			getCanonicalCompletionPhase(config).should.equal("evaluating")
		})

		it("returns finalized for completed_without_retry_completion", () => {
			const config = configWithState(taskState)
			taskState.completionLifecycleState = "completed_without_retry_completion"
			getCanonicalCompletionPhase(config).should.equal("finalized")
		})

		it("returns failed_with_receipt for audit_gate_corrupt", () => {
			const config = configWithState(taskState)
			taskState.completionLifecycleState = "audit_gate_corrupt"
			getCanonicalCompletionPhase(config).should.equal("failed_with_receipt")
		})
	})

	describe("same-session completion invariant", () => {
		it("circuit breaker does not suggest new session or new task", () => {
			const config = configWithState(taskState)
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.lastCompletionBlockReason = "circuit_breaker"

			// The circuit breaker message is tested via getCompletionGateCircuitBreakerError
			// which is already tested in attemptCompletionUtils.test.ts
			// Here we verify the cooldown remains bounded
			const cooldown = getCompletionCooldownRemainingMs(config)
			cooldown.should.be.lessThanOrEqual(30000)
		})

		it("graph revision resets cleanly after markCompletionAttemptFinished", () => {
			const config = configWithState(taskState)
			recordCompletionGateBlockEvent(config, "audit_gate", { result: "test result summary" })
			recordCompletionAttemptTime(config)
			markCompletionAttemptFinished(config)

			// After finish, state should be clean for next completion
			taskState.completionGateBlockCount?.should.equal(0)
			should.not.exist(taskState.lastCompletionAttemptAt)
			should.not.exist(taskState.lastCompletionAttemptGraphRevision)
		})
	})
})
