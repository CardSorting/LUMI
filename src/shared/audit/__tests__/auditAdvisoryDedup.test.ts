import {
	getNewAdvisoryViolations,
	isDuplicateAdvisoryAudit,
	shouldEmitAdvisoryAuditChatEvent,
} from "@shared/audit/auditAdvisoryDedup"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditAdvisoryDedup", () => {
	it("detects duplicate advisory audits with the same violations", () => {
		const previous = enrichAuditMetadata({ violations: ["missing_validation_evidence", "result_empty"] })
		const current = enrichAuditMetadata({ violations: ["result_empty", "missing_validation_evidence"] })
		expect(isDuplicateAdvisoryAudit(current, previous)).to.equal(true)
	})

	it("allows emission when new violations appear", () => {
		const previous = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const current = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "unresolved_work_marker:todo"],
		})
		expect(isDuplicateAdvisoryAudit(current, previous)).to.equal(false)
		expect(getNewAdvisoryViolations(current, previous)).to.deep.equal(["unresolved_work_marker:todo"])
		expect(shouldEmitAdvisoryAuditChatEvent(current, previous)).to.equal(true)
	})

	it("skips chat emission for repeated unchanged advisories", () => {
		const previous = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const current = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		expect(shouldEmitAdvisoryAuditChatEvent(current, previous)).to.equal(false)
	})

	it("emits when divergence state changes even with same violations", () => {
		const previous = enrichAuditMetadata({ violations: ["missing_validation_evidence"], divergence_detected: false })
		const current = enrichAuditMetadata({ violations: ["missing_validation_evidence"], divergence_detected: true })
		expect(shouldEmitAdvisoryAuditChatEvent(current, previous)).to.equal(true)
	})
})
