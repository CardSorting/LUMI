import {
	buildAdvisoryRollupSection,
	computeAuditHealthSummary,
	computeAuditHealthSummaryWithBaseline,
	getPersistentViolations,
	hasUnresolvedAdvisoryFindings,
	shouldEscalateFromAdvisory,
} from "@shared/audit/auditRollup"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditRollup", () => {
	it("detects persistent violations across advisory and completion audits", () => {
		const advisory = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "unresolved_work_marker:todo"],
		})
		const completion = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "result_too_short"],
		})

		expect(getPersistentViolations(advisory, completion)).to.deep.equal(["missing_validation_evidence"])
		expect(hasUnresolvedAdvisoryFindings(advisory, completion)).to.equal(true)
		expect(shouldEscalateFromAdvisory(advisory, completion)).to.equal(true)
	})

	it("builds advisory rollup section for unresolved drift", () => {
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const completion = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const section = buildAdvisoryRollupSection(advisory, completion)
		expect(section).to.contain("Advisory Rollup")
		expect(section).to.contain("missing validation evidence")
	})

	it("computes audit health summary across snapshots", () => {
		const older = enrichAuditMetadata({ violations: ["result_empty"] })
		const newer = enrichAuditMetadata({ violations: [] })
		const summary = computeAuditHealthSummary([{ auditMetadata: older }, { auditMetadata: newer }])
		expect(summary?.snapshotCount).to.equal(2)
		expect(summary?.trend).to.equal("improving")
		expect(summary?.latestGrade).to.equal("A")
		expect(summary?.gateBlockCount).to.equal(0)
	})

	it("counts gate block snapshots in health summary", () => {
		const blocked = enrichAuditMetadata({ violations: ["result_empty"], gate_blocked: true })
		const summary = computeAuditHealthSummary([{ auditMetadata: blocked }, { auditMetadata: blocked }])
		expect(summary?.gateBlockCount).to.equal(2)
	})

	it("aggregates suppressed violation counts across snapshots", () => {
		const withSuppressed = enrichAuditMetadata({
			violations: [],
			suppressed_violations: ["missing_validation_evidence", "result_empty"],
		})
		const summary = computeAuditHealthSummary([{ auditMetadata: withSuppressed }])
		expect(summary?.suppressedViolationCount).to.equal(2)
	})

	it("tracks persistent violations and latest score delta", () => {
		const older = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "result_empty"],
		})
		const middle = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
		})
		const latest = enrichAuditMetadata({ violations: [] })
		const snapshots = [{ auditMetadata: older }, { auditMetadata: middle }, { auditMetadata: latest }]
		const summary = computeAuditHealthSummary(snapshots)
		expect(summary?.persistentViolationCount).to.equal(0)
		expect(summary?.latestScoreDelta).to.equal((latest.hardening_score ?? 0) - (middle.hardening_score ?? 0))
		expect(summary?.trend).to.equal("improving")
	})

	it("counts persistent violations present in first and last snapshots", () => {
		const older = enrichAuditMetadata({
			violations: ["missing_validation_evidence", "result_empty"],
		})
		const latest = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
		})
		const summary = computeAuditHealthSummary([{ auditMetadata: older }, { auditMetadata: latest }])
		expect(summary?.persistentViolationCount).to.equal(1)
	})

	it("tracks trailing gate block streak and plan regression", () => {
		const blocked = enrichAuditMetadata({ violations: ["result_empty"], gate_blocked: true })
		const summary = computeAuditHealthSummary([{ auditMetadata: blocked }, { auditMetadata: blocked }])
		expect(summary?.trailingGateBlockStreak).to.equal(2)

		const planBaseline = { violations: [], hardening_score: 95, hardening_grade: "A" as const }
		const regressed = { violations: ["result_empty"], hardening_score: 50, hardening_grade: "F" as const }
		const withBaseline = computeAuditHealthSummaryWithBaseline([{ auditMetadata: regressed }], planBaseline)
		expect(withBaseline?.planRegressionDetected).to.equal(true)
	})
})
