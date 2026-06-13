import { findAuditMessageIndex, findMessageIndexForAuditTs } from "@shared/audit/auditNavigation"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"

describe("auditNavigation", () => {
	it("finds audit-bearing message index by timestamp", () => {
		const audit = enrichAuditMetadata({ violations: [] })
		const messages = [
			{ ts: 100, type: "say", say: "task" },
			{ ts: 200, type: "say", say: "info" },
			{ ts: 200, type: "say", say: "completion_result", auditMetadata: audit },
		] as DietCodeMessage[]
		expect(findMessageIndexForAuditTs(messages, 200)).to.equal(2)
		expect(findMessageIndexForAuditTs(messages, 999)).to.equal(-1)
	})

	it("resolves snapshot-specific message index when ts is shared", () => {
		const audit = enrichAuditMetadata({ violations: [] })
		const messages = [
			{ ts: 300, type: "say", say: "completion_result", auditMetadata: audit },
			{ ts: 300, type: "ask", ask: "plan_mode_respond", auditMetadata: audit },
		] as DietCodeMessage[]

		expect(findAuditMessageIndex(messages, { ts: 300, source: "plan" })).to.equal(1)
		expect(findAuditMessageIndex(messages, { ts: 300, source: "completion" })).to.equal(0)
	})
})
