import {
	buildPreCompletionChecklistMarkdown,
	buildPreCompletionChecklistSummary,
	shouldShowPreCompletionChecklist,
} from "@shared/audit/auditPreCompletionChecklist"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditPreCompletionChecklist", () => {
	it("builds structured checklist with failing score and violations", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "unresolved_work_marker:todo"],
		})
		const summary = buildPreCompletionChecklistSummary(metadata, { scoreThreshold: 95 })
		expect(summary).to.not.equal(undefined)
		expect(summary?.blocked).to.equal(true)
		expect(summary?.items.some((item) => item.key === "hardening_score")).to.equal(true)
		expect(summary?.items.some((item) => item.status === "fail")).to.equal(true)
		expect(shouldShowPreCompletionChecklist(summary)).to.equal(true)
	})

	it("marks passing gate when audit is clean", () => {
		const metadata = enrichAuditMetadata({ violations: [] })
		const summary = buildPreCompletionChecklistSummary(metadata, { scoreThreshold: 50 })
		expect(summary?.blocked).to.equal(false)
		expect(summary?.items.some((item) => item.key === "violations" && item.status === "pass")).to.equal(true)
	})

	it("exports markdown checklist for clipboard", () => {
		const metadata = enrichAuditMetadata({ violations: ["result_empty"] })
		const summary = buildPreCompletionChecklistSummary(metadata, { scoreThreshold: 95 })
		const markdown = buildPreCompletionChecklistMarkdown(summary!)
		expect(markdown).to.contain("Pre-Completion Quality Gate")
		expect(markdown).to.contain("BLOCKED")
	})
})
