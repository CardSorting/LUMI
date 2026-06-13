import { buildQualityGateStatus } from "@shared/audit/auditGateStatus"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditGateStatus", () => {
	it("returns undefined when no audit grade exists", () => {
		expect(buildQualityGateStatus(undefined)).to.be.undefined
	})

	it("builds passed quality gate status for hardened completions", () => {
		const metadata = enrichAuditMetadata({ violations: [] })
		const status = buildQualityGateStatus(metadata, { gateEnabled: true, scoreThreshold: 50 })
		expect(status?.passed).to.equal(true)
		expect(status?.status).to.equal("ready")
		expect(status?.blocked).to.equal(false)
	})

	it("builds blocked quality gate status with reason codes", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			gate_blocked: true,
			gate_reason_codes: ["score_below_threshold"],
			artifact_manifest_path: ".audit/task-1.manifest.json",
		})
		const status = buildQualityGateStatus(metadata, { gateEnabled: true, scoreThreshold: 90 })
		expect(status?.blocked).to.equal(true)
		expect(status?.passed).to.equal(false)
		expect(status?.reasonCodes).to.include("score_below_threshold")
		expect(status?.artifactPaths?.manifest).to.equal(".audit/task-1.manifest.json")
	})
})
