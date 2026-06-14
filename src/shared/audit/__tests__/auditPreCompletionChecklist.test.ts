import { buildPreCompletionChecklistBlock, buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditPreCompletionChecklist", () => {
	it("builds machine-parseable checklist XML", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			hardening_score: 42,
		})
		const summary = buildPreCompletionChecklistSummary(metadata, { gateEnabled: true, scoreThreshold: 50 })
		expect(summary).to.exist
		const block = buildPreCompletionChecklistBlock(summary!)
		expect(block).to.contain("<pre_completion_checklist")
		expect(block).to.contain('<check key="hardening_score"')
	})
})
