import {
	buildFileWriteContentAdvisory,
	detectFileContentAuditSignals,
	detectVerificationOutputFailures,
} from "@shared/audit/auditFileWrite"
import { expect } from "chai"

describe("auditFileWrite", () => {
	it("detects verification output failures from test output", () => {
		expect(detectVerificationOutputFailures("Tests: 2 failed, 10 passed")).to.include("verification_output_failure")
		expect(detectVerificationOutputFailures("AssertionError: expected true")).to.include("verification_output_failure")
		expect(detectVerificationOutputFailures("All tests passed")).to.be.empty
	})

	it("detects unresolved work markers in file content", () => {
		const signals = detectFileContentAuditSignals("// TODO: fix this\nconst x = 1")
		expect(signals).to.include("unresolved_work_marker:todo")
	})

	it("builds file write advisory when markers present", () => {
		const advisory = buildFileWriteContentAdvisory("function foo() { // FIXME }", "src/foo.ts")
		expect(advisory).to.contain("<file_write_audit_advisory")
		expect(advisory).to.contain("fixme")
	})

	it("returns empty advisory for clean content", () => {
		expect(buildFileWriteContentAdvisory("export const ok = true", "src/ok.ts")).to.equal("")
	})
})
