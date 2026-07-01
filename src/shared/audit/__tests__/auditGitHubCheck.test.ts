import { buildQualityGateStatus } from "@shared/audit/auditGateStatus"
import { buildGitHubCheckRunOutput } from "@shared/audit/auditGitHubCheck"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditGitHubCheck", () => {
	it("builds GitHub Checks API compatible output", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			gate_blocked: true,
			gate_reason_codes: ["score_below_threshold"],
		})
		const status = buildQualityGateStatus(metadata, { gateEnabled: true, scoreThreshold: 90 })!
		const output = buildGitHubCheckRunOutput(metadata, status, { taskId: "task-gh" })
		expect(output.status).to.equal("completed")
		expect(output.conclusion).to.equal("neutral")
		expect(output.output.title).to.contain("Advisory quality findings")
		expect(output.output.annotations?.length).to.be.greaterThan(0)
		expect(output.output.annotations?.every((annotation) => annotation.annotation_level === "warning")).to.equal(true)
	})
})
