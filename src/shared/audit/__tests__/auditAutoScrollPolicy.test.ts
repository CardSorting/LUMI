import { DEFAULT_AUDIT_AUTO_SCROLL_POLICY, shouldAutoScrollAuditEvent } from "@shared/audit/auditAutoScrollPolicy"
import { getAutoScrollAuditEventTs } from "@shared/audit/auditHistoryUtils"
import type { AuditMessageSnapshot } from "@shared/audit/auditMessages"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditAutoScrollPolicy", () => {
	const snapshot = (ts: number, source: AuditMessageSnapshot["source"], violations: string[] = []): AuditMessageSnapshot => ({
		ts,
		source,
		auditMetadata: enrichAuditMetadata({
			violations,
			gate_blocked: source === "gate_block",
			divergence_detected: false,
		}),
	})

	it("always scrolls new gate blocks with default policy", () => {
		const blocked = snapshot(2, "gate_block")
		expect(shouldAutoScrollAuditEvent(blocked)).to.equal(true)
		expect(getAutoScrollAuditEventTs([snapshot(1, "completion"), blocked], 1)).to.equal(2)
	})

	it("skips non-critical advisories by default", () => {
		const advisory = snapshot(3, "advisory", ["result_too_short"])
		expect(shouldAutoScrollAuditEvent(advisory)).to.equal(false)
		expect(getAutoScrollAuditEventTs([snapshot(1, "completion"), advisory], 1)).to.equal(undefined)
	})

	it("scrolls critical advisories with default policy", () => {
		const advisory = snapshot(3, "advisory", ["missing_validation_evidence"])
		expect(shouldAutoScrollAuditEvent(advisory)).to.equal(true)
	})

	it("respects advisory never mode", () => {
		const advisory = snapshot(3, "advisory", ["missing_validation_evidence"])
		const policy = { ...DEFAULT_AUDIT_AUTO_SCROLL_POLICY, advisoryMode: "never" as const }
		expect(shouldAutoScrollAuditEvent(advisory, policy)).to.equal(false)
	})
})
