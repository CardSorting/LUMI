import { buildAuditEventLiveAnnouncement } from "@shared/audit/auditEventAnnouncements"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditEventAnnouncements", () => {
	it("announces gate block events with attempt and reasons", () => {
		const announcement = buildAuditEventLiveAnnouncement({
			ts: 1,
			source: "gate_block",
			auditMetadata: enrichAuditMetadata({
				violations: ["result_empty"],
				gate_blocked: true,
				gate_block_count: 2,
				gate_reason_codes: ["score_below_threshold"],
			}),
		})
		expect(announcement).to.contain("gate blocked")
		expect(announcement).to.contain("attempt 2")
		expect(announcement).to.contain("quality threshold")
	})

	it("announces act-mode advisory events", () => {
		const announcement = buildAuditEventLiveAnnouncement({
			ts: 2,
			source: "advisory",
			auditMetadata: enrichAuditMetadata({
				violations: ["missing_validation_evidence"],
				divergence_detected: true,
			}),
		})
		expect(announcement).to.contain("Act-mode audit advisory")
		expect(announcement).to.contain("Divergent")
	})
})
