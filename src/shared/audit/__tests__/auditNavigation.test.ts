import { findMessageIndexForAuditTs } from "@shared/audit/auditNavigation"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"

describe("auditNavigation", () => {
	it("finds message index by timestamp for scroll navigation", () => {
		const messages = [
			{ ts: 100, type: "say", say: "task" },
			{ ts: 200, type: "say", say: "info" },
		] as DietCodeMessage[]
		expect(findMessageIndexForAuditTs(messages, 200)).to.equal(1)
		expect(findMessageIndexForAuditTs(messages, 999)).to.equal(-1)
	})
})
