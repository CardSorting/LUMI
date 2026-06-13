import {
	buildAdvisoryRollupSection,
	computeAuditHealthSummary,
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
})
