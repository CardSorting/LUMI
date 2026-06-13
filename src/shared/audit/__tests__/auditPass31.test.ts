import { buildAutoScrollPolicyFromSettings } from "@shared/audit/auditAutoScrollPolicy"
import { buildAuditHealthAnnouncement, buildAuditHealthChipLabel } from "@shared/audit/auditHealthDigest"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import { shouldAutoExpandViolationLedger } from "@shared/audit/auditSessionLedger"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditHealthDigest", () => {
	const health: AuditHealthSummary = {
		snapshotCount: 3,
		averageScore: 65,
		gateBlockCount: 2,
		advisorySnapshotCount: 1,
		persistentViolationCount: 1,
		trailingGateBlockStreak: 2,
		criticalViolationCount: 1,
		warningViolationCount: 0,
		suppressedViolationCount: 0,
		latestScoreDelta: -5,
		planRegressionDetected: false,
		trend: "degrading",
	}

	it("builds compact chip labels", () => {
		expect(buildAuditHealthChipLabel(health)).to.contain("2× blocked")
		expect(buildAuditHealthChipLabel(health)).to.contain("advisory")
	})

	it("builds screen reader announcements", () => {
		const announcement = buildAuditHealthAnnouncement(health)
		expect(announcement).to.contain("Task audit")
		expect(announcement).to.contain("degrading")
	})
})

describe("buildAutoScrollPolicyFromSettings", () => {
	it("disables advisory scroll when act-mode advisory is off", () => {
		const policy = buildAutoScrollPolicyFromSettings({ auditActModeAdvisoryEnabled: false })
		expect(policy.advisoryMode).to.equal("never")
		expect(policy.scrollGateBlocks).to.equal(true)
	})

	it("respects explicit auto-scroll mode override from settings", () => {
		const policy = buildAutoScrollPolicyFromSettings({ auditAdvisoryAutoScrollMode: "all" })
		expect(policy.advisoryMode).to.equal("all")
	})

	it("explicit mode overrides disabled advisory flags", () => {
		const policy = buildAutoScrollPolicyFromSettings({
			auditActModeAdvisoryEnabled: false,
			auditAdvisoryAutoScrollMode: "critical",
		})
		expect(policy.advisoryMode).to.equal("critical")
	})
})

describe("shouldAutoExpandViolationLedger", () => {
	const snapshot = (ts: number, violations: string[]) => ({
		ts,
		source: "completion" as const,
		auditMetadata: enrichAuditMetadata({ violations }),
	})

	it("expands when open violation count increases", () => {
		const before = [snapshot(1, ["result_empty"])]
		const after = [snapshot(1, ["result_empty"]), snapshot(2, ["result_empty", "missing_validation_evidence"])]
		expect(shouldAutoExpandViolationLedger(before, 1)).to.equal(false)
		expect(shouldAutoExpandViolationLedger(after, 1)).to.equal(true)
	})
})
