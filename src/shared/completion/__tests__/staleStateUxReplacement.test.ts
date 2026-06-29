import { describe, it } from "mocha"
import "should"
import { buildGateLifecycleDecision } from "../gateLifecycleDecision"
import {
	classifyGateLifecycleFreshness,
	GATE_LIFECYCLE_STALE_MS,
	getFreshnessReconciliationLabel,
	resolveGateLifecycleSnapshot,
} from "../gateLifecycleMessages"

describe("stale-state UX replacement", () => {
	describe("getFreshnessReconciliationLabel", () => {
		it("returns 'Synchronized' for current freshness", () => {
			getFreshnessReconciliationLabel("current").should.equal("Synchronized")
		})

		it("returns active reconciliation language for stale freshness", () => {
			const label = getFreshnessReconciliationLabel("stale")
			label.should.containEql("Synchronizing")
			// Must NOT use the word "stale"
			label.should.not.match(/\bstale\b/i)
		})

		it("returns validation language for unknown freshness", () => {
			const label = getFreshnessReconciliationLabel("unknown")
			label.should.containEql("Validating")
			label.should.not.match(/\bstale\b/i)
		})
	})

	describe("resolveGateLifecycleSnapshot reconciliation label", () => {
		it("includes reconciliationLabel in snapshot", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "engineering_in_progress",
				activeLane: "completion",
				reasonCode: "preflight.unknown",
				operatorMessage: "working",
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
			const snapshot = resolveGateLifecycleSnapshot([
				{ ts: 100, type: "say", say: "info", text: "gate", gateLifecycleStatus: decision },
			])
			snapshot.reconciliationLabel.should.be.a.String()
			snapshot.reconciliationLabel.length.should.be.greaterThan(0)
		})

		it("includes reconciliationLabel for unknown snapshot", () => {
			const snapshot = resolveGateLifecycleSnapshot([])
			snapshot.reconciliationLabel.should.equal("Validating completion readiness")
		})
		it("uses reconciliation language instead of 'stale' for old snapshots", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "finalization_ready",
				activeLane: "finalization",
				reasonCode: "finalization.ready",
				operatorMessage: "ready",
				engineering: "pending",
				verification: "passed",
				documentation: "pending",
				ledger: "pending",
				finalization: "pending",
				allowedActions: ["run_finalization"],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			// Force evaluatedAt to an old timestamp to simulate staleness
			;(decision as { evaluatedAt: number }).evaluatedAt = 100
			const oldTime = 100
			const snapshot = resolveGateLifecycleSnapshot(
				[{ ts: oldTime, type: "say", say: "info", text: "gate", gateLifecycleStatus: decision }],
				{ now: oldTime + GATE_LIFECYCLE_STALE_MS + 1 },
			)
			snapshot.freshness.should.equal("stale")
			// The operator-facing label must not contain "stale"
			snapshot.reconciliationLabel.should.not.match(/\bstale\b/i)
			snapshot.reconciliationLabel.should.containEql("Synchronizing")
		})
	})

	describe("classifyGateLifecycleFreshness still works as internal detail", () => {
		it("classifies current correctly", () => {
			classifyGateLifecycleFreshness(Date.now()).should.equal("current")
		})

		it("classifies stale correctly", () => {
			classifyGateLifecycleFreshness(100, 100 + GATE_LIFECYCLE_STALE_MS + 1).should.equal("stale")
		})

		it("classifies unknown correctly", () => {
			classifyGateLifecycleFreshness(undefined).should.equal("unknown")
		})
	})
})
