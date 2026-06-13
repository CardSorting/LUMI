import { detectVerificationOutputFailures } from "@shared/audit/auditFileWrite"
import { appendTextToToolResponse, extractTextFromToolResponse, isVerificationCommand } from "@shared/audit/auditPostTool"
import { isCompletionBlockedByAudit } from "@shared/audit/completionAudit"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditPostTool", () => {
	it("detects verification commands", () => {
		expect(isVerificationCommand("npm test")).to.equal(true)
		expect(isVerificationCommand("pytest tests/")).to.equal(true)
		expect(isVerificationCommand("ls -la")).to.equal(false)
	})

	it("extracts and appends text from tool responses", () => {
		expect(extractTextFromToolResponse("hello")).to.equal("hello")
		expect(extractTextFromToolResponse([{ type: "text", text: "output" }])).to.equal("output")
		expect(appendTextToToolResponse("base", " suffix")).to.equal("base suffix")
	})

	it("detects verification output failures", () => {
		expect(detectVerificationOutputFailures("npm ERR! Test failed")).to.not.be.empty
	})

	it("blocks completion on advisory escalation even when score passes threshold", () => {
		const advisory = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
		})
		const completion = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			hardening_score: 95,
		})
		expect(
			isCompletionBlockedByAudit(completion, {
				advisoryMetadata: advisory,
				advisoryEscalationEnabled: true,
				scoreThreshold: 50,
			}),
		).to.equal(true)
	})
})
