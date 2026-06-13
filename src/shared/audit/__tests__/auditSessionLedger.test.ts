import { buildViolationSessionLedger, countOpenViolationLedgerEntries } from "@shared/audit/auditSessionLedger"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditSessionLedger", () => {
	const snapshot = (ts: number, violations: string[], source: "completion" | "advisory" = "completion") => ({
		ts,
		source,
		auditMetadata: enrichAuditMetadata({ violations }),
	})

	it("tracks open and resolved violations across snapshots", () => {
		const ledger = buildViolationSessionLedger([
			snapshot(1, ["result_empty"]),
			snapshot(2, ["result_empty", "missing_validation_evidence"]),
			snapshot(3, ["missing_validation_evidence"]),
		])
		expect(countOpenViolationLedgerEntries(ledger)).to.equal(1)
		const resolved = ledger.find((entry) => entry.violation === "result_empty")
		expect(resolved?.status).to.equal("resolved")
		expect(resolved?.snapshotCount).to.equal(2)
		const open = ledger.find((entry) => entry.violation === "missing_validation_evidence")
		expect(open?.status).to.equal("open")
		expect(open?.snapshotCount).to.equal(2)
	})
})
