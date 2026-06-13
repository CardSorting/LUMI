import {
	buildAuditHistoryAnnouncement,
	buildAuditHistoryMarkdown,
	clampAuditFocusIndex,
	countTrailingGateBlocks,
	extractAuditScoreTimeline,
	getAuditSnapshotKey,
	reconcileAuditHistoryState,
	shouldAutoExpandAuditHistory,
	shouldShowAuditHistoryStrip,
} from "@shared/audit/auditHistoryUtils"
import type { AuditMessageSnapshot } from "@shared/audit/auditMessages"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditHistoryUtils", () => {
	const snapshot = (ts: number, source: AuditMessageSnapshot["source"] = "completion"): AuditMessageSnapshot => ({
		ts,
		source,
		auditMetadata: enrichAuditMetadata({ violations: [] }),
	})

	it("builds stable snapshot keys", () => {
		expect(getAuditSnapshotKey(snapshot(1000, "plan"))).to.equal("1000-plan")
	})

	it("clamps focus index to valid range", () => {
		expect(clampAuditFocusIndex(-1, 3)).to.equal(0)
		expect(clampAuditFocusIndex(5, 3)).to.equal(2)
		expect(clampAuditFocusIndex(0, 0)).to.equal(0)
	})

	it("reconciles stale selection when snapshots shrink", () => {
		const snapshots = [snapshot(1), snapshot(2)]
		const reconciled = reconcileAuditHistoryState(snapshots, 5, "999-completion")
		expect(reconciled.focusedIndex).to.equal(1)
		expect(reconciled.selectedKey).to.equal(null)
	})

	it("preserves valid selection across reconciliation", () => {
		const snapshots = [snapshot(1), snapshot(2, "plan")]
		const reconciled = reconcileAuditHistoryState(snapshots, 1, "2-plan")
		expect(reconciled.focusedIndex).to.equal(1)
		expect(reconciled.selectedKey).to.equal("2-plan")
	})

	it("builds screen reader announcements with gate context", () => {
		const blocked = snapshot(3, "gate_block")
		blocked.auditMetadata.gate_blocked = true
		blocked.auditMetadata.hardening_grade = "F"
		blocked.auditMetadata.hardening_score = 20
		const announcement = buildAuditHistoryAnnouncement(blocked, "Gate Block")
		expect(announcement).to.contain("Gate Block")
		expect(announcement).to.contain("grade F")
		expect(announcement).to.contain("gate blocked")
	})

	it("extracts score timeline and gate block streak metrics", () => {
		const blocked = snapshot(2, "gate_block")
		blocked.auditMetadata.gate_blocked = true
		blocked.auditMetadata.hardening_score = 40
		const passing = snapshot(1)
		passing.auditMetadata.hardening_score = 80
		expect(extractAuditScoreTimeline([passing, blocked])).to.deep.equal([80, 40])
		expect(countTrailingGateBlocks([passing, blocked])).to.equal(1)
		expect(shouldAutoExpandAuditHistory([passing, blocked], 1)).to.equal(true)
		expect(shouldAutoExpandAuditHistory([passing, blocked], 2)).to.equal(false)
	})

	it("controls strip visibility and exports markdown timeline", () => {
		const passing = snapshot(1)
		expect(shouldShowAuditHistoryStrip([passing])).to.equal(false)

		const blocked = snapshot(2, "gate_block")
		blocked.auditMetadata.gate_blocked = true
		expect(shouldShowAuditHistoryStrip([blocked])).to.equal(true)

		const markdown = buildAuditHistoryMarkdown([passing, blocked])
		expect(markdown).to.contain("## Task Audit History")
		expect(markdown).to.contain("Gate Block")
	})
})
