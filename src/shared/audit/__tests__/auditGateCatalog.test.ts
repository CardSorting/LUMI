import {
	buildGateBlockEventSummary,
	buildGateReasonLinesFromMetadata,
	enrichAuditMetadataWithGateDecision,
	formatGateReasonLabel,
	formatGateReasonsForDisplay,
} from "@shared/audit/auditGateCatalog"
import { evaluateAuditGate } from "@shared/audit/auditGateReport"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditGateCatalog", () => {
	it("provides human-readable gate reason labels", () => {
		expect(formatGateReasonLabel("advisory_escalation")).to.contain("advisory")
		expect(formatGateReasonLabel("plan_regression")).to.contain("regressed")
	})

	it("formats gate reasons for display with remediation", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			intent_coverage: 0.1,
			entropy_score: 0.9,
		})
		const decision = evaluateAuditGate(metadata, { scoreThreshold: 95 })
		const lines = formatGateReasonsForDisplay(decision.reasons)
		expect(lines.length).to.be.greaterThan(0)
	})

	it("enriches audit metadata with gate decision fields", () => {
		const metadata = enrichAuditMetadata({ violations: ["result_empty"] })
		const decision = evaluateAuditGate(metadata, { scoreThreshold: 95 })
		const enriched = enrichAuditMetadataWithGateDecision(metadata, decision, 2)
		expect(enriched.gate_blocked).to.equal(true)
		expect(enriched.gate_block_count).to.equal(2)
		expect(enriched.gate_reason_codes?.length).to.be.greaterThan(0)
	})

	it("builds gate block event summary for audit trail messages", () => {
		const metadata = enrichAuditMetadata({ violations: ["result_empty"] })
		const decision = evaluateAuditGate(metadata, { scoreThreshold: 95 })
		const summary = buildGateBlockEventSummary(decision, 1)
		expect(summary).to.contain("blocked")
		expect(summary).to.contain("attempt 1")
	})

	it("builds gate reason lines from persisted audit metadata", () => {
		const metadata = enrichAuditMetadata({
			violations: ["result_empty"],
			gate_reason_codes: ["score_below_threshold", "policy_violations"],
		})
		const lines = buildGateReasonLinesFromMetadata(metadata)
		expect(lines.length).to.equal(2)
		expect(lines[0]).to.contain("quality threshold")
	})
})
