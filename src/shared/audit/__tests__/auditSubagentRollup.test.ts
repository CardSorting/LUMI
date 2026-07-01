import {
	buildSubagentAuditSummary,
	buildSubagentHandoffMarkdown,
	formatSubagentParentSignal,
} from "@shared/audit/auditSubagentRollup"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"

describe("auditSubagentRollup", () => {
	it("aggregates parent gate signals from subagent swarm status", () => {
		const messages = [
			{
				ts: 1,
				type: "say",
				say: "subagent",
				text: JSON.stringify({
					status: "running",
					total: 2,
					completed: 0,
					successes: 0,
					failures: 0,
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					contextWindow: 0,
					maxContextTokens: 0,
					maxContextUsagePercentage: 0,
					items: [
						{
							id: "a",
							name: "Agent 1",
							index: 1,
							prompt: "fix tests",
							status: "running",
							toolCalls: 0,
							inputTokens: 0,
							outputTokens: 0,
							totalCost: 0,
							contextTokens: 0,
							contextWindow: 0,
							contextUsagePercentage: 0,
							criticalSignals: ["GATE: PARENT_BLOCKED (2)", "SIGNAL: PARENT_ADVISORY_FINDINGS"],
						},
						{
							id: "b",
							name: "Agent 2",
							index: 2,
							prompt: "lint",
							status: "pending",
							toolCalls: 0,
							inputTokens: 0,
							outputTokens: 0,
							totalCost: 0,
							contextTokens: 0,
							contextWindow: 0,
							contextUsagePercentage: 0,
							criticalSignals: ["SIGNAL: PARENT_GATE_BLOCKED"],
						},
					],
				}),
			},
		] as DietCodeMessage[]

		const summary = buildSubagentAuditSummary(messages)
		expect(summary?.totalAgents).to.equal(2)
		expect(summary?.runningCount).to.equal(1)
		expect(summary?.hasParentGateBlocked).to.equal(false)
		expect(summary?.hasParentAdvisoryFindings).to.equal(true)
		expect(summary?.parentGateSignals).to.have.length(3)
	})

	it("formats parent gate signals for UI labels", () => {
		expect(formatSubagentParentSignal("GATE: PARENT_BLOCKED (2)")).to.contain("Parent advisory findings")
		expect(formatSubagentParentSignal("SIGNAL: PARENT_ADVISORY_FINDINGS")).to.contain("advisory")
		expect(formatSubagentParentSignal("GATE: PARENT_ATTEMPTS (5)")).to.contain("Parent completion attempts")
		expect(formatSubagentParentSignal("GATE: PARENT_RETRY_STATUS (wait)")).to.contain("retry status")
		expect(formatSubagentParentSignal("GATE: PARENT_BLOCK_HISTORY (4)")).to.contain("advisory history")
	})

	it("builds markdown handoff section for audit export", () => {
		const summary = buildSubagentAuditSummary([
			{
				ts: 1,
				type: "say",
				say: "subagent",
				text: JSON.stringify({
					status: "running",
					total: 1,
					completed: 0,
					successes: 0,
					failures: 0,
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					contextWindow: 0,
					maxContextTokens: 0,
					maxContextUsagePercentage: 0,
					items: [
						{
							id: "a",
							name: "Agent 1",
							index: 1,
							prompt: "fix",
							status: "running",
							toolCalls: 0,
							inputTokens: 0,
							outputTokens: 0,
							totalCost: 0,
							contextTokens: 0,
							contextWindow: 0,
							contextUsagePercentage: 0,
							criticalSignals: ["SIGNAL: PARENT_GATE_BLOCKED"],
						},
					],
				}),
			},
		] as DietCodeMessage[])
		expect(summary).to.not.equal(undefined)
		const markdown = buildSubagentHandoffMarkdown(summary!)
		expect(markdown).to.contain("Subagent Audit Handoff")
		expect(markdown).to.contain("Parent advisory findings")
	})
})
