import {
	getLatestGateAuditFromMessages,
	getPreviousAdvisoryAuditBeforeTs,
	getPreviousGateAuditFromMessages,
} from "@shared/audit/auditMessages"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"

describe("auditMessages gate audit selection", () => {
	it("prefers gate-relevant audits over newer advisories", () => {
		const completion = enrichAuditMetadata({ violations: ["result_empty"], gate_blocked: true })
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const messages = [
			{ ts: 1, type: "say", say: "completion_result", auditMetadata: completion },
			{ ts: 2, type: "say", say: "info", auditMetadata: advisory },
		] as DietCodeMessage[]

		expect(getLatestGateAuditFromMessages(messages)?.violations).to.deep.equal(["result_empty"])
	})

	it("returns previous gate audit skipping advisories", () => {
		const older = enrichAuditMetadata({ violations: ["result_empty"] })
		const newer = enrichAuditMetadata({ violations: [] })
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const messages = [
			{ ts: 1, type: "say", say: "completion_result", auditMetadata: older },
			{ ts: 2, type: "ask", ask: "plan_mode_respond", auditMetadata: newer },
			{ ts: 3, type: "say", say: "info", auditMetadata: advisory },
		] as DietCodeMessage[]

		expect(getPreviousGateAuditFromMessages(messages)?.violations).to.deep.equal(["result_empty"])
	})

	it("finds advisory baseline before a timestamp", () => {
		const first = enrichAuditMetadata({ violations: ["result_empty"] })
		const second = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const messages = [
			{ ts: 1, type: "say", say: "info", auditMetadata: first },
			{ ts: 2, type: "say", say: "info", auditMetadata: second },
		] as DietCodeMessage[]

		expect(getPreviousAdvisoryAuditBeforeTs(messages, 2)?.violations).to.deep.equal(["result_empty"])
	})
})
