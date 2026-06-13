import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { inferAgentModeFromMessages, stripPartialPlanSummaryMessages } from "@shared/inferAgentModeFromMessages"
import { expect } from "chai"

describe("inferAgentModeFromMessages", () => {
	it("returns act when yolo mode is enabled", () => {
		expect(inferAgentModeFromMessages([], true)).to.equal("act")
	})

	it("returns plan when no finalized plan exists", () => {
		const messages = [
			{ ts: 1, type: "say", say: "task", text: "Build feature" },
			{ ts: 2, type: "say", say: "api_req_started", text: "{}" },
		] as DietCodeMessage[]
		expect(inferAgentModeFromMessages(messages, false)).to.equal("plan")
	})

	it("returns act after finalized plan_summary", () => {
		const messages = [
			{ ts: 1, type: "say", say: "plan_summary", text: '{"response":"Plan"}', partial: false },
		] as DietCodeMessage[]
		expect(inferAgentModeFromMessages(messages, false)).to.equal("act")
	})

	it("ignores partial plan_summary when inferring mode", () => {
		const messages = [
			{ ts: 1, type: "say", say: "plan_summary", text: '{"response":"Partial"}', partial: true },
		] as DietCodeMessage[]
		expect(inferAgentModeFromMessages(messages, false)).to.equal("plan")
	})

	it("returns act for legacy finalized plan_mode_respond ask", () => {
		const messages = [
			{
				ts: 1,
				type: "ask",
				ask: "plan_mode_respond",
				text: JSON.stringify({ response: "Legacy plan" }),
				partial: false,
			},
		] as DietCodeMessage[]
		expect(inferAgentModeFromMessages(messages, false)).to.equal("act")
	})

	it("returns plan when user feedback after plan requests replan", () => {
		const messages = [
			{ ts: 1, type: "say", say: "plan_summary", text: '{"response":"Plan"}', partial: false },
			{ ts: 2, type: "say", say: "user_feedback", text: "Let's replan with a different approach" },
		] as DietCodeMessage[]
		expect(inferAgentModeFromMessages(messages, false)).to.equal("plan")
	})
})

describe("stripPartialPlanSummaryMessages", () => {
	it("removes partial plan_summary messages only", () => {
		const messages = [
			{ ts: 1, type: "say", say: "plan_summary", partial: true, text: "{}" },
			{ ts: 2, type: "say", say: "plan_summary", partial: false, text: "{}" },
			{ ts: 3, type: "say", say: "text", text: "hello" },
		] as DietCodeMessage[]
		const filtered = stripPartialPlanSummaryMessages(messages)
		expect(filtered).to.have.length(2)
		expect(filtered.some((m) => m.partial === true)).to.equal(false)
	})
})
