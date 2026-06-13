import { getViolationSeverity, hasCriticalViolations, partitionViolationsBySeverity } from "@shared/audit/auditSeverity"
import { expect } from "chai"

describe("auditSeverity", () => {
	it("classifies known violation types by severity tier", () => {
		expect(getViolationSeverity("security_leak")).to.equal("critical")
		expect(getViolationSeverity("missing_validation_evidence")).to.equal("critical")
		expect(getViolationSeverity("unresolved_work_marker:todo")).to.equal("warning")
		expect(getViolationSeverity("result_too_short")).to.equal("warning")
		expect(getViolationSeverity("custom_hook_violation")).to.equal("info")
	})

	it("partitions violations for critical-only gate mode", () => {
		const partitioned = partitionViolationsBySeverity([
			"missing_validation_evidence",
			"unresolved_work_marker:todo",
			"custom_hook_violation",
		])
		expect(partitioned.critical).to.have.length(1)
		expect(partitioned.warning).to.have.length(1)
		expect(partitioned.info).to.have.length(1)
		expect(hasCriticalViolations(["unresolved_work_marker:todo"])).to.equal(false)
		expect(hasCriticalViolations(["security_leak"])).to.equal(true)
	})
})
