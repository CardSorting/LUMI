import { describeGateReadiness, serializeIntentThresholdOverrides } from "@shared/audit/auditGateReadiness"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditGateReadiness", () => {
	it("describes ready gate when audit passes threshold", () => {
		const metadata = enrichAuditMetadata({ violations: [], intent_coverage: 0.9, entropy_score: 0.1 })
		const summary = describeGateReadiness(metadata, { scoreThreshold: 50 })
		expect(summary.level).to.equal("ready")
		expect(summary.shortLabel).to.equal("Ready")
	})

	it("describes blocked gate when metadata indicates gate block", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			gate_blocked: true,
			gate_reason_codes: ["score_below_threshold"],
		})
		const summary = describeGateReadiness(metadata, { scoreThreshold: 95 })
		expect(summary.level).to.equal("blocked")
	})

	it("serializes intent threshold overrides omitting zero values", () => {
		expect(serializeIntentThresholdOverrides({ FIX: 15, TEST: 0 })).to.equal('{"FIX":15}')
	})

	it("surfaces pending act-mode advisories as marginal readiness", () => {
		const metadata = enrichAuditMetadata({ violations: [] })
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const summary = describeGateReadiness(metadata, {
			scoreThreshold: 50,
			advisoryMetadata: advisory,
		})
		expect(summary.level).to.equal("warning")
		expect(summary.shortLabel).to.equal("Advisory")
	})
})
