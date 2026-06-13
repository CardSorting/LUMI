import { computeAuditSnapshotDiff } from "@shared/audit/auditSnapshotDiff"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditSnapshotDiff", () => {
	it("computes new, resolved, and persistent violations", () => {
		const baseline = {
			...enrichAuditMetadata({
				violations: ["missing_validation_evidence", "result_empty"],
			}),
			hardening_score: 60,
		}
		const current = {
			...enrichAuditMetadata({
				violations: ["missing_validation_evidence", "reported_blocker"],
			}),
			hardening_score: 55,
		}
		const diff = computeAuditSnapshotDiff(baseline, current)!
		expect(diff.newViolations).to.deep.equal(["reported_blocker"])
		expect(diff.resolvedViolations).to.deep.equal(["result_empty"])
		expect(diff.persistentViolations).to.deep.equal(["missing_validation_evidence"])
		expect(diff.scoreDelta).to.equal(-5)
	})
})
