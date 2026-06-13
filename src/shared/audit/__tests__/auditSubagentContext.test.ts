import { buildSubagentAuditContext, buildSubagentGateSignals } from "@shared/audit/auditSubagentContext"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditSubagentContext", () => {
	it("returns empty string when no audit state exists", () => {
		expect(buildSubagentAuditContext({})).to.equal("")
	})

	it("builds parent audit context for subagent injection", () => {
		const lastCompletionAudit = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			gate_blocked: true,
			gate_reason_codes: ["score_below_threshold"],
		})
		const context = buildSubagentAuditContext({
			lastCompletionAudit,
			completionGateBlockCount: 2,
		})
		expect(context).to.contain("<parent_audit_context>")
		expect(context).to.contain("BLOCKED")
		expect(context).to.contain("gate blocks this task: 2")
	})

	it("builds gate signals for blocked parent", () => {
		const lastCompletionAudit = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			gate_blocked: true,
			gate_reason_codes: ["score_below_threshold"],
		})
		const signals = buildSubagentGateSignals({
			lastCompletionAudit,
			completionGateBlockCount: 2,
			gateOptions: { gateEnabled: true, scoreThreshold: 50 },
		})
		expect(signals).to.include("GATE: PARENT_BLOCKED (2)")
		expect(signals).to.include("SIGNAL: PARENT_COMPLETION_GATE_BLOCKED")
		expect(signals).to.include("SIGNAL: PARENT_GATE_BLOCKED")
	})

	it("returns no gate signals when gate is disabled", () => {
		const signals = buildSubagentGateSignals({
			completionGateBlockCount: 1,
			gateOptions: { gateEnabled: false },
		})
		expect(signals).to.deep.equal([])
	})
})
