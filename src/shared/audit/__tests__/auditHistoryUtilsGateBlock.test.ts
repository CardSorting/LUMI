import { getLatestAdvisorySnapshot, getLatestGateBlockSnapshot } from "@shared/audit/auditHistoryUtils"
import type { AuditMessageSnapshot } from "@shared/audit/auditMessages"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("getLatestAdvisorySnapshot", () => {
	it("returns the most recent advisory snapshot", () => {
		const snapshots: AuditMessageSnapshot[] = [
			{ ts: 1, source: "advisory", auditMetadata: enrichAuditMetadata({ violations: ["result_empty"] }) },
			{ ts: 2, source: "completion", auditMetadata: enrichAuditMetadata({ violations: [] }) },
			{ ts: 3, source: "advisory", auditMetadata: enrichAuditMetadata({ violations: ["missing_validation_evidence"] }) },
		]
		expect(getLatestAdvisorySnapshot(snapshots)?.ts).to.equal(3)
		expect(getLatestGateBlockSnapshot(snapshots)).to.equal(undefined)
	})
})

describe("getLatestGateBlockSnapshot", () => {
	it("returns the most recent gate block snapshot", () => {
		const snapshots: AuditMessageSnapshot[] = [
			{ ts: 1, source: "gate_block", auditMetadata: enrichAuditMetadata({ gate_blocked: true }) },
			{ ts: 2, source: "completion", auditMetadata: enrichAuditMetadata({ violations: [] }) },
			{ ts: 3, source: "gate_block", auditMetadata: enrichAuditMetadata({ gate_blocked: true, gate_block_count: 2 }) },
		]
		expect(getLatestGateBlockSnapshot(snapshots)?.ts).to.equal(3)
	})
})
