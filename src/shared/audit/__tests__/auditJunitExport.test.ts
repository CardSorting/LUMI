import { evaluateCompletionGate } from "@shared/audit/auditGateReport"
import { buildAuditJunitXml } from "@shared/audit/auditJunitExport"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditJunitExport", () => {
	it("builds passing JUnit XML when no violations", () => {
		const metadata = enrichAuditMetadata({ violations: [] })
		const xml = buildAuditJunitXml(metadata, { taskId: "task-1" })
		expect(xml).to.contain('tests="1"')
		expect(xml).to.contain('failures="0"')
		expect(xml).to.contain("hardening_gate")
	})

	it("includes violation and gate failures", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
		})
		const decision = evaluateCompletionGate(metadata, { gateEnabled: true, scoreThreshold: 95 })
		const xml = buildAuditJunitXml(metadata, { taskId: "task-2", gateDecision: decision })
		expect(xml).to.contain('failures="2"')
		expect(xml).to.contain("missing_validation_evidence")
		expect(xml).to.contain("audit.gate")
	})
})
