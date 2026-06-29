import { describe, it } from "mocha"
import "should"
import {
	type CanonicalCompletionSnapshot,
	deriveAuditValidity,
	deriveBreatherStatus,
	isWithinReconciliationDebounce,
	mapLifecycleToCanonicalPhase,
	RECONCILIATION_DEBOUNCE_MS,
	validateCanonicalSnapshot,
} from "../canonicalSnapshot"
import { buildGateLifecycleDecision } from "../gateLifecycleDecision"

function makeSnapshot(overrides: Partial<CanonicalCompletionSnapshot> = {}): CanonicalCompletionSnapshot {
	const decision = buildGateLifecycleDecision({
		lifecycleState: "engineering_in_progress",
		activeLane: "completion",
		reasonCode: "preflight.unknown",
		operatorMessage: "Working",
		engineering: "pending",
		verification: "pending",
		documentation: "pending",
		ledger: "pending",
		finalization: "not_applicable",
		allowedActions: ["attempt_completion"],
		forbiddenActions: [],
		recoveryPath: [],
		receiptEligible: false,
		moreToolCallsUseful: true,
		userInputRequired: false,
	})
	return {
		phase: "evaluating",
		lifecycleState: "engineering_in_progress",
		decision,
		freshness: "current",
		auditValidity: "not_evaluated",
		breatherStatus: "inactive",
		completionEligible: false,
		graphRevision: 1,
		evaluatedAt: Date.now(),
		...overrides,
	}
}

describe("canonicalSnapshot", () => {
	describe("mapLifecycleToCanonicalPhase", () => {
		it("maps completed_without_retry_completion to finalized", () => {
			mapLifecycleToCanonicalPhase("completed_without_retry_completion").should.equal("finalized")
		})

		it("maps audit_gate_corrupt to failed_with_receipt", () => {
			mapLifecycleToCanonicalPhase("audit_gate_corrupt").should.equal("failed_with_receipt")
		})

		it("maps receipt_sealed to finalized", () => {
			mapLifecycleToCanonicalPhase("receipt_sealed").should.equal("finalized")
		})

		it("maps engineering_verified to completing", () => {
			mapLifecycleToCanonicalPhase("engineering_verified").should.equal("completing")
		})

		it("maps engineering_in_progress to evaluating", () => {
			mapLifecycleToCanonicalPhase("engineering_in_progress").should.equal("evaluating")
		})

		it("maps completion_retry_locked to blocked when engineering is not passed", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "completion_retry_locked",
				activeLane: "completion",
				reasonCode: "retry.locked",
				operatorMessage: "locked",
				engineering: "failed",
				verification: "pending",
				documentation: "pending",
				ledger: "pending",
				finalization: "not_applicable",
				allowedActions: [],
				forbiddenActions: ["attempt_completion"],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			mapLifecycleToCanonicalPhase("completion_retry_locked", decision).should.equal("blocked")
		})

		it("maps completion_retry_locked to completing when engineering is passed", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "completion_retry_locked",
				activeLane: "finalization",
				reasonCode: "retry.locked",
				operatorMessage: "locked but verified",
				engineering: "passed",
				verification: "passed",
				documentation: "pending",
				ledger: "pending",
				finalization: "pending",
				allowedActions: ["run_finalization"],
				forbiddenActions: ["attempt_completion"],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			mapLifecycleToCanonicalPhase("completion_retry_locked", decision).should.equal("completing")
		})

		it("maps completion_retry_locked to finalized when finalization already passed", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "completion_retry_locked",
				activeLane: "finalization",
				reasonCode: "retry.locked",
				operatorMessage: "locked but verified",
				engineering: "passed",
				verification: "passed",
				documentation: "passed",
				ledger: "passed",
				finalization: "passed",
				allowedActions: ["run_finalization"],
				forbiddenActions: ["attempt_completion"],
				recoveryPath: [],
				receiptEligible: true,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			// Should skip synchronizing and go straight to finalized — no transitional churn
			mapLifecycleToCanonicalPhase("completion_retry_locked", decision).should.equal("finalized")
		})

		it("maps finalization_completed to finalized", () => {
			mapLifecycleToCanonicalPhase("finalization_completed").should.equal("finalized")
		})

		it("maps finalization_running to completing", () => {
			mapLifecycleToCanonicalPhase("finalization_running").should.equal("completing")
		})

		it("maps finalization_ready to completing", () => {
			mapLifecycleToCanonicalPhase("finalization_ready").should.equal("completing")
		})
	})

	describe("validateCanonicalSnapshot", () => {
		it("accepts a valid evaluating snapshot", () => {
			should(() => validateCanonicalSnapshot(makeSnapshot())).not.throw()
		})

		it("rejects ready_for_completion with stale freshness", () => {
			should(() =>
				validateCanonicalSnapshot(
					makeSnapshot({
						phase: "ready_for_completion",
						freshness: "stale",
						completionEligible: true,
						auditValidity: "valid",
					}),
				),
			).throw(/ready_for_completion with stale freshness/)
		})

		it("rejects ready_for_completion with invalidated audit", () => {
			should(() =>
				validateCanonicalSnapshot(
					makeSnapshot({
						phase: "ready_for_completion",
						freshness: "current",
						auditValidity: "invalidated",
						completionEligible: true,
					}),
				),
			).throw(/ready_for_completion with invalidated audit/)
		})

		it("rejects blocked phase with completionEligible=true", () => {
			should(() =>
				validateCanonicalSnapshot(
					makeSnapshot({
						phase: "blocked",
						completionEligible: true,
					}),
				),
			).throw(/blocked phase with completionEligible/)
		})

		it("rejects finalized without receipt eligibility", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "completed_without_retry_completion",
				activeLane: "none",
				reasonCode: "receipt.sealed",
				operatorMessage: "done",
				engineering: "passed",
				verification: "passed",
				documentation: "passed",
				ledger: "passed",
				finalization: "passed",
				allowedActions: [],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: false,
				userInputRequired: false,
			})
			should(() =>
				validateCanonicalSnapshot(
					makeSnapshot({
						phase: "finalized",
						lifecycleState: "completed_without_retry_completion",
						decision,
						completionEligible: true,
					}),
				),
			).throw(/finalized without receipt eligibility/)
		})
	})

	describe("deriveAuditValidity", () => {
		it("returns not_evaluated when no cache key exists", () => {
			deriveAuditValidity(undefined, "key-1", undefined).should.equal("not_evaluated")
		})

		it("returns invalidated when cache key differs from current", () => {
			deriveAuditValidity("old-key", "new-key", Date.now()).should.equal("invalidated")
		})

		it("returns valid when cache key matches and within TTL", () => {
			deriveAuditValidity("same-key", "same-key", Date.now()).should.equal("valid")
		})

		it("returns stale_pending_reconciliation when TTL exceeded", () => {
			const oldTimestamp = Date.now() - 6 * 60 * 1000
			deriveAuditValidity("same-key", "same-key", oldTimestamp).should.equal("stale_pending_reconciliation")
		})
	})

	describe("deriveBreatherStatus", () => {
		it("returns inactive when no blocks", () => {
			deriveBreatherStatus(undefined, 0, 0).should.equal("inactive")
		})

		it("returns reconciling when cooldown is active", () => {
			deriveBreatherStatus("audit_gate", 2, 5000).should.equal("reconciling")
		})

		it("returns inactive when cooldown expired — no lingering completed state", () => {
			deriveBreatherStatus("audit_gate", 2, 0).should.equal("inactive")
		})
	})

	describe("isWithinReconciliationDebounce", () => {
		it("returns false when no prior attempt", () => {
			isWithinReconciliationDebounce(undefined, undefined, 1).should.be.false()
		})

		it("returns false when graph revision changed", () => {
			isWithinReconciliationDebounce(Date.now(), 1, 2).should.be.false()
		})

		it("returns true when same revision within debounce window", () => {
			isWithinReconciliationDebounce(Date.now(), 1, 1).should.be.true()
		})

		it("returns false when same revision but debounce expired", () => {
			const past = Date.now() - RECONCILIATION_DEBOUNCE_MS - 100
			isWithinReconciliationDebounce(past, 1, 1).should.be.false()
		})
	})
})
