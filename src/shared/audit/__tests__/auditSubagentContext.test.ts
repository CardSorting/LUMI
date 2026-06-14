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

	it("includes parent gate block reason, failed stage, and attempt count in context and signals", () => {
		const envelope =
			'<completion_gate_envelope schema_version="1"><completion_gate_health level="elevated" /></completion_gate_envelope>'
		const context = buildSubagentAuditContext({
			completionGateBlockCount: 3,
			lastCompletionBlockReason: "audit_gate",
			lastCompletionFailedStage: "audit",
			completionAttemptCount: 5,
			completionGatePressureLevel: "elevated",
			completionGateObservabilityEnvelope: envelope,
		})
		expect(context).to.contain("Last parent gate block reason: audit_gate")
		expect(context).to.contain("Last parent gate failed stage: audit")
		expect(context).to.contain("Parent gate pressure level: elevated")
		expect(context).to.contain("<completion_gate_envelope")

		const signals = buildSubagentGateSignals({
			completionGateBlockCount: 3,
			lastCompletionBlockReason: "audit_gate",
			lastCompletionFailedStage: "audit",
			completionAttemptCount: 5,
			completionGatePressureLevel: "elevated",
			completionGateRetryStatus: "wait",
			gateOptions: { gateEnabled: true, scoreThreshold: 50 },
		})
		expect(signals).to.include("GATE: PARENT_LAST_REASON (audit_gate)")
		expect(signals).to.include("GATE: PARENT_FAILED_STAGE (audit)")
		expect(signals).to.include("GATE: PARENT_PRESSURE (elevated)")
		expect(signals).to.include("GATE: PARENT_ATTEMPTS (5)")
		expect(signals).to.include("GATE: PARENT_RETRY_STATUS (wait)")
	})

	it("emits workspace policy and suppression signals", () => {
		const lastCompletionAudit = enrichAuditMetadata({
			violations: [],
			suppressed_violations: ["missing_validation_evidence"],
			workspace_gate_policy_applied: true,
		})
		const signals = buildSubagentGateSignals({
			lastCompletionAudit,
			gateOptions: { gateEnabled: true, scoreThreshold: 50 },
		})
		expect(signals).to.include("SIGNAL: PARENT_WORKSPACE_GATE_POLICY")
		expect(signals).to.include("SIGNAL: PARENT_SUPPRESSED_VIOLATIONS")
		const context = buildSubagentAuditContext({ lastCompletionAudit })
		expect(context).to.contain("Workspace gate policy")
		expect(context).to.contain("Suppressed violations")
	})
})
