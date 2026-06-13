import {
	getAllAuditsFromMessages,
	getAuditSnapshotsFromMessages,
	getAuditSummaryLabel,
	getAuditTrend,
	getLatestAdvisoryAuditFromMessages,
	getLatestAuditFromMessages,
	getLatestPlanAuditFromMessages,
	getPreviousAuditFromMessages,
	isAdvisoryAuditInfoMessage,
	messageCarriesAuditMetadata,
} from "@shared/audit/auditMessages"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"

describe("auditMessages", () => {
	const audit = enrichAuditMetadata({
		violations: [],
		intent_coverage: 0.9,
	})

	it("detects audit-bearing completion and plan messages", () => {
		expect(
			messageCarriesAuditMetadata({
				ts: 1,
				type: "say",
				say: "completion_result",
				auditMetadata: audit,
			} as DietCodeMessage),
		).to.equal(true)
		expect(
			messageCarriesAuditMetadata({
				ts: 1,
				type: "ask",
				ask: "plan_mode_respond",
				auditMetadata: audit,
			} as DietCodeMessage),
		).to.equal(true)
		expect(
			messageCarriesAuditMetadata({
				ts: 1,
				type: "say",
				say: "text",
				auditMetadata: audit,
			} as DietCodeMessage),
		).to.equal(false)
	})

	it("returns the newest audit metadata from message history", () => {
		const older = enrichAuditMetadata({ violations: ["result_empty"] })
		const newer = enrichAuditMetadata({ violations: [] })
		const messages = [
			{ ts: 1, type: "say", say: "completion_result", auditMetadata: older },
			{ ts: 2, type: "ask", ask: "plan_mode_respond", auditMetadata: newer },
		] as DietCodeMessage[]

		const latest = getLatestAuditFromMessages(messages)
		expect(latest?.hardening_grade).to.equal("A")
	})

	it("returns the latest plan audit for regression baselines", () => {
		const planAudit = enrichAuditMetadata({ violations: [] })
		const messages = [
			{ ts: 1, type: "ask", ask: "plan_mode_respond", auditMetadata: planAudit },
			{
				ts: 2,
				type: "say",
				say: "completion_result",
				auditMetadata: enrichAuditMetadata({ violations: ["result_empty"] }),
			},
		] as DietCodeMessage[]

		expect(getLatestPlanAuditFromMessages(messages)?.hardening_grade).to.equal("A")
	})

	it("formats audit summary labels for task header display", () => {
		const clean = enrichAuditMetadata({ violations: [], hardening_grade: "A", hardening_score: 100 })
		expect(getAuditSummaryLabel(clean)).to.equal("Grade A (100/100)")

		const dirty = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			hardening_grade: "F",
			hardening_score: 30,
		})
		expect(getAuditSummaryLabel(dirty)).to.contain("1 violation")
	})

	it("collects all audits chronologically and detects score trends", () => {
		const older = enrichAuditMetadata({ violations: ["result_empty"] })
		const newer = enrichAuditMetadata({ violations: [] })
		const messages = [
			{ ts: 1, type: "say", say: "completion_result", auditMetadata: older },
			{ ts: 2, type: "ask", ask: "plan_mode_respond", auditMetadata: newer },
		] as DietCodeMessage[]

		expect(getAllAuditsFromMessages(messages)).to.have.length(2)
		expect(getPreviousAuditFromMessages(messages)?.hardening_score).to.equal(older.hardening_score)
		expect(getAuditTrend(older, newer)).to.equal("improved")
		expect(getAuditTrend(newer, older)).to.equal("degraded")
	})

	it("builds timestamped audit snapshots for history UI", () => {
		const audit = enrichAuditMetadata({ violations: [] })
		const messages = [
			{ ts: 1000, type: "say", say: "completion_result", auditMetadata: audit },
			{ ts: 2000, type: "ask", ask: "plan_mode_respond", auditMetadata: audit },
		] as DietCodeMessage[]

		const snapshots = getAuditSnapshotsFromMessages(messages)
		expect(snapshots).to.have.length(2)
		expect(snapshots[0].source).to.equal("completion")
		expect(snapshots[1].source).to.equal("plan")
		expect(snapshots[0].ts).to.equal(1000)
	})

	it("includes gate block snapshots from info messages with gate audit metadata", () => {
		const audit = enrichAuditMetadata({ violations: ["result_empty"], gate_blocked: true })
		const messages = [{ ts: 3000, type: "say", say: "info", auditMetadata: audit }] as DietCodeMessage[]

		expect(messageCarriesAuditMetadata(messages[0])).to.equal(true)
		const snapshots = getAuditSnapshotsFromMessages(messages)
		expect(snapshots).to.have.length(1)
		expect(snapshots[0].source).to.equal("gate_block")
	})

	it("ignores info messages without gate_blocked or advisory audit metadata", () => {
		const messages = [
			{ ts: 3000, type: "say", say: "info", auditMetadata: enrichAuditMetadata({ violations: [] }) },
		] as DietCodeMessage[]

		expect(messageCarriesAuditMetadata(messages[0])).to.equal(false)
	})

	it("includes act-mode advisory snapshots from info messages with violations", () => {
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const messages = [{ ts: 4000, type: "say", say: "info", auditMetadata: advisory }] as DietCodeMessage[]

		expect(messageCarriesAuditMetadata(messages[0])).to.equal(true)
		expect(isAdvisoryAuditInfoMessage(messages[0])).to.equal(true)
		const snapshots = getAuditSnapshotsFromMessages(messages)
		expect(snapshots).to.have.length(1)
		expect(snapshots[0].source).to.equal("advisory")
		expect(getLatestAdvisoryAuditFromMessages(messages)?.violations).to.deep.equal(["missing_validation_evidence"])
	})
})
