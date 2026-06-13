import {
	buildAuditReportMarkdown,
	computeHardeningAssessment,
	enrichAuditMetadata,
	formatViolationLabel,
	getIntentClassification,
} from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("taskAuditUtils", () => {
	it("assigns grade A for fully hardened completions", () => {
		const assessment = computeHardeningAssessment({
			violations: [],
			joy_zoning_violations: [],
			entropy_score: 0.2,
			intent_coverage: 0.9,
		})

		expect(assessment.score).to.equal(100)
		expect(assessment.grade).to.equal("A")
		expect(assessment.criticalCount).to.equal(0)
	})

	it("penalizes unresolved markers and missing validation evidence", () => {
		const assessment = computeHardeningAssessment({
			violations: ["unresolved_work_marker:todo", "missing_validation_evidence", "reported_blocker"],
			joy_zoning_violations: ["layer_violation"],
			entropy_score: 0.9,
			intent_coverage: 0.1,
		})

		expect(assessment.score).to.be.lessThan(50)
		expect(assessment.grade).to.equal("F")
		expect(assessment.criticalCount).to.be.greaterThan(0)
	})

	it("enriches audit metadata with hardening score and grade", () => {
		const enriched = enrichAuditMetadata({
			violations: [],
			intent_coverage: 0.85,
			entropy_score: 0.15,
		})

		expect(enriched.hardening_score).to.equal(100)
		expect(enriched.hardening_grade).to.equal("A")
	})

	it("formats violation labels for UI display", () => {
		expect(formatViolationLabel("unresolved_work_marker:not_implemented")).to.equal("Unresolved Marker: not implemented")
	})

	it("normalizes unknown intents to GENERAL", () => {
		expect(getIntentClassification("INVESTIGATE")).to.equal("INVESTIGATE")
		expect(getIntentClassification(undefined)).to.equal("GENERAL")
	})

	it("includes hardening grade in markdown audit report", () => {
		const markdown = buildAuditReportMarkdown(
			enrichAuditMetadata({
				intent_classification: "FIX",
				result_checksum: "abc123",
				entropy_score: 0.3,
				intent_coverage: 0.8,
				divergence_detected: false,
				audited_at: 1_700_000_000_000,
			}),
		)

		expect(markdown).to.contain("Hardening Grade")
		expect(markdown).to.contain("FIX")
	})
})
