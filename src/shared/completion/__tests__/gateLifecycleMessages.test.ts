import { describe, it } from "mocha"
import "should"
import { buildGateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import {
	classifyGateLifecycleFreshness,
	GATE_LIFECYCLE_STALE_MS,
	resolveGateLifecycleSnapshot,
} from "@shared/completion/gateLifecycleMessages"

describe("gateLifecycleMessages freshness", () => {
	it("resolves unknown when no gate messages exist", () => {
		const snapshot = resolveGateLifecycleSnapshot([])
		snapshot.freshness.should.equal("unknown")
		should(snapshot.decision).be.undefined()
	})

	it("marks stale snapshots by evaluatedAt age", () => {
		const decision = {
			...buildGateLifecycleDecision({
				lifecycleState: "finalization_ready",
				activeLane: "finalization",
				reasonCode: "finalization.ready",
				operatorMessage: "ready",
				engineering: "passed",
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
			}),
			evaluatedAt: 100,
		}
		const snapshot = resolveGateLifecycleSnapshot(
			[{ ts: 100, type: "say", say: "info", text: "gate", gateLifecycleStatus: decision }],
			{ now: 100 + GATE_LIFECYCLE_STALE_MS + 1 },
		)
		snapshot.freshness.should.equal("stale")
		classifyGateLifecycleFreshness(decision.evaluatedAt, 100 + GATE_LIFECYCLE_STALE_MS + 1).should.equal("stale")
	})
})
