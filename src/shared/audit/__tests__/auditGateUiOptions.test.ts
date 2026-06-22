import { type AuditGateConfig } from "@shared/audit/auditGateConfig"
import { evaluateAuditGate } from "@shared/audit/auditGateReport"
import { buildUIGateEvaluationOptions, metadataUsesNewViolationsGate } from "@shared/audit/auditGateUiOptions"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"

describe("auditGateUiOptions", () => {
	const settings: AuditGateConfig = {
		gateEnabled: true,
		scoreThreshold: 50,
		criticalOnly: false,
	}

	it("includes plan baseline from message history", () => {
		const planAudit = enrichAuditMetadata({ violations: [] })
		const messages = [{ ts: 1, type: "ask", ask: "plan_mode_respond", auditMetadata: planAudit }] as DietCodeMessage[]

		const options = buildUIGateEvaluationOptions(settings, messages)
		expect(options.planBaselineMetadata?.hardening_grade).to.equal("A")
	})

	it("enables new-violations-only when metadata carries policy_violations gate reason", () => {
		const baseline = enrichAuditMetadata({ violations: ["result_empty"] })
		const current = enrichAuditMetadata({
			violations: ["result_empty", "missing_validation_evidence"],
			gate_reason_codes: ["policy_violations"],
			workspace_gate_policy_applied: true,
		})
		const messages = [
			{ ts: 1, type: "say", say: "completion_result", auditMetadata: baseline },
			{ ts: 2, type: "say", say: "info", auditMetadata: current },
		] as DietCodeMessage[]

		expect(metadataUsesNewViolationsGate(current)).to.equal(true)
		const options = buildUIGateEvaluationOptions(settings, messages, current)
		expect(options.newViolationsOnly).to.equal(true)
		expect(options.baselineMetadata?.violations).to.deep.equal(["result_empty"])
	})

	it("blocks only new violations in UI preview when new-code gate is active", () => {
		const baseline = enrichAuditMetadata({ violations: ["result_empty"] })
		const current = enrichAuditMetadata({
			violations: ["result_empty", "missing_validation_evidence"],
			gate_reason_codes: ["policy_violations"],
		})
		const messages = [
			{ ts: 1, type: "say", say: "completion_result", auditMetadata: baseline },
			{ ts: 2, type: "say", say: "info", auditMetadata: current },
		] as DietCodeMessage[]

		const options = buildUIGateEvaluationOptions(settings, messages, current)
		const decision = evaluateAuditGate(current, options)
		expect(decision.blocked).to.equal(true)
		expect(decision.reasons.some((reason) => reason.code === "policy_violations")).to.equal(true)
	})

	it("includes advisory metadata from act-mode info messages", () => {
		const advisory = enrichAuditMetadata({ violations: ["missing_validation_evidence"] })
		const messages = [{ ts: 1, type: "say", say: "info", auditMetadata: advisory }] as DietCodeMessage[]

		const options = buildUIGateEvaluationOptions(settings, messages)
		expect(options.advisoryMetadata?.violations).to.deep.equal(["missing_validation_evidence"])
	})
})
