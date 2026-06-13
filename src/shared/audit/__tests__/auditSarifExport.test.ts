import { buildAuditSarifJson, buildAuditSarifReport } from "@shared/audit/auditSarifExport"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditSarifExport", () => {
	it("builds valid SARIF 2.1.0 structure", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			gate_reason_codes: ["score_below_threshold"],
			gate_blocked: true,
		})
		const sarif = buildAuditSarifReport(metadata)
		expect(sarif.version).to.equal("2.1.0")
		expect(sarif.runs).to.have.length(1)
		expect(sarif.runs[0].results.length).to.be.greaterThan(0)
		expect(sarif.runs[0].tool.driver.rules.some((r) => r.id === "missing_validation_evidence")).to.equal(true)
		expect(sarif.runs[0].tool.driver.rules.some((r) => r.id === "gate:score_below_threshold")).to.equal(true)
	})

	it("serializes SARIF JSON for CI upload", () => {
		const metadata = enrichAuditMetadata({ violations: ["result_empty"] })
		const json = buildAuditSarifJson(metadata)
		const parsed = JSON.parse(json)
		expect(parsed.version).to.equal("2.1.0")
	})
})
