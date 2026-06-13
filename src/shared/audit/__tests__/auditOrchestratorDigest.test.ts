import { buildOrchestratorGateStatus } from "@shared/audit/auditOrchestratorDigest"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditOrchestratorDigest", () => {
	it("returns undefined when no audit metadata", () => {
		expect(buildOrchestratorGateStatus(undefined)).to.equal(undefined)
	})

	it("builds ready gate status for passing audits", () => {
		const metadata = enrichAuditMetadata({ violations: [], intent_coverage: 0.9, entropy_score: 0.1 })
		const status = buildOrchestratorGateStatus(metadata)
		expect(status?.ready).to.equal(true)
		expect(status?.score).to.be.a("number")
	})

	it("builds blocked gate status with reason labels", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			intent_coverage: 0.1,
			entropy_score: 0.9,
			gate_block_count: 2,
		})
		const status = buildOrchestratorGateStatus(metadata, { scoreThreshold: 95 })
		expect(status?.ready).to.equal(false)
		expect(status?.reasonLabels.length).to.be.greaterThan(0)
		expect(status?.gateBlockCount).to.equal(2)
	})

	it("includes artifact paths when present", () => {
		const metadata = enrichAuditMetadata({
			violations: [],
			artifact_sarif_path: ".audit/sarif/latest.sarif.json",
			artifact_manifest_path: ".audit/latest.manifest.json",
		})
		const status = buildOrchestratorGateStatus(metadata)
		expect(status?.artifactSarifPath).to.equal(".audit/sarif/latest.sarif.json")
		expect(status?.artifactManifestPath).to.equal(".audit/latest.manifest.json")
	})
})
