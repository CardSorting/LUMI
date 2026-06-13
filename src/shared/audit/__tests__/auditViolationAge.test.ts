import type { AuditMessageSnapshot } from "@shared/audit/auditMessages"
import { computeTrailingViolationAges, getTrailingViolationAge } from "@shared/audit/auditViolationAge"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditViolationAge", () => {
	const snapshot = (ts: number, violations: string[]): AuditMessageSnapshot => ({
		ts,
		source: "completion",
		auditMetadata: enrichAuditMetadata({ violations }),
	})

	it("counts trailing snapshots for persistent violations", () => {
		const snapshots = [
			snapshot(1, ["missing_validation_evidence"]),
			snapshot(2, ["missing_validation_evidence", "result_empty"]),
			snapshot(3, ["missing_validation_evidence"]),
		]
		expect(getTrailingViolationAge(snapshots, "missing_validation_evidence")).to.equal(3)
		expect(getTrailingViolationAge(snapshots, "result_empty")).to.equal(0)
	})

	it("builds age map for latest snapshot violations", () => {
		const snapshots = [snapshot(1, ["result_empty"]), snapshot(2, ["result_empty", "missing_validation_evidence"])]
		const ages = computeTrailingViolationAges(snapshots)
		expect(ages.get("result_empty")).to.equal(2)
		expect(ages.get("missing_validation_evidence")).to.equal(1)
	})
})
