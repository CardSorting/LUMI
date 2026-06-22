import {
	buildGateDecisionSummary,
	buildPreCompletionChecklist,
	evaluateAuditGate,
	isCompletionBlockedByDecision,
} from "@shared/audit/auditGateReport"
import { isCompletionBlockedByAudit } from "@shared/audit/completionAudit"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditGateReport", () => {
	it("evaluates gate decision with reason codes when score is below threshold", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "unresolved_work_marker:todo"],
			intent_coverage: 0.1,
			entropy_score: 0.9,
		})
		const decision = evaluateAuditGate(metadata)
		expect(decision.blocked).to.equal(true)
		expect(decision.reasons.some((r) => r.code === "score_below_threshold")).to.equal(true)
		expect(isCompletionBlockedByDecision(decision)).to.equal(true)
		expect(isCompletionBlockedByAudit(metadata)).to.equal(true)
	})

	it("returns gate_disabled reason when gate is off", () => {
		const metadata = enrichAuditMetadata({ violations: ["result_empty", "reported_blocker"] })
		const decision = evaluateAuditGate(metadata, { gateEnabled: false })
		expect(decision.blocked).to.equal(false)
		expect(decision.reasons[0]?.code).to.equal("gate_disabled")
	})

	it("blocks on advisory escalation with explicit reason", () => {
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const completion = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "result_empty"],
			hardening_score: 95,
		})
		const decision = evaluateAuditGate(completion, {
			advisoryMetadata: advisory,
			advisoryEscalationEnabled: true,
		})
		expect(decision.blocked).to.equal(true)
		expect(decision.reasons.some((r) => r.code === "advisory_escalation")).to.equal(true)
	})

	it("builds pre-completion checklist with blocked status", () => {
		const metadata = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const checklist = buildPreCompletionChecklist(metadata, { scoreThreshold: 95 })
		expect(checklist).to.contain("<pre_completion_checklist>")
		expect(checklist).to.contain("BLOCKED")
	})

	it("includes new-code gate context in pre-completion checklist", () => {
		const baseline = enrichAuditMetadata({ violations: ["result_empty"] })
		const metadata = enrichAuditMetadata({ violations: ["result_empty", "missing_validation_evidence"] })
		const checklist = buildPreCompletionChecklist(metadata, {
			newViolationsOnly: true,
			baselineMetadata: baseline,
		})
		expect(checklist).to.contain("New-code gate")
		expect(checklist).to.contain("Grandfathered")
		expect(checklist).to.contain("missing validation evidence")
	})

	it("builds gate ready summary when passing", () => {
		const metadata = enrichAuditMetadata({ violations: [], intent_coverage: 0.9, entropy_score: 0.1 })
		const decision = evaluateAuditGate(metadata)
		expect(buildGateDecisionSummary(decision)).to.contain("Gate ready")
	})

	it("blocks only on new violations when newViolationsOnly is enabled", () => {
		const baseline = enrichAuditMetadata({ violations: ["result_empty"] })
		const metadata = enrichAuditMetadata({ violations: ["result_empty"] })
		const passing = evaluateAuditGate(metadata, { newViolationsOnly: true, baselineMetadata: baseline })
		expect(passing.blocked).to.equal(false)

		const withNew = enrichAuditMetadata({ violations: ["result_empty", "missing_validation_evidence"] })
		const blocked = evaluateAuditGate(withNew, { newViolationsOnly: true, baselineMetadata: baseline })
		expect(blocked.blocked).to.equal(true)
		expect(blocked.reasons.some((r) => r.code === "policy_violations")).to.equal(true)
	})
})
