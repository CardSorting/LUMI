import { canSendTaskFeedback } from "@shared/agentActivity"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { isChatInputEnabled, resolveChatSendRoute } from "./chatInputPolicy"

describe("chatInputPolicy", () => {
	it("blocks follow_up when no live task session", () => {
		const messages: DietCodeMessage[] = [{ type: "say", say: "text", text: "Done", ts: 1 }]
		expect(resolveChatSendRoute(messages, undefined, { taskSessionActive: false })).to.equal("none")
	})

	it("routes between-turn messages as follow_up", () => {
		const messages: DietCodeMessage[] = [
			{ type: "say", say: "task", ts: 1 },
			{ type: "say", say: "text", text: "Done", ts: 2 },
		]
		expect(resolveChatSendRoute(messages, undefined, { taskSessionActive: true })).to.equal("follow_up")
		expect(canSendTaskFeedback(messages)).to.equal(true)
	})

	it("routes blocking asks through the ask path", () => {
		const messages: DietCodeMessage[] = [{ type: "ask", ask: "tool", ts: 1 }]
		expect(resolveChatSendRoute(messages, "tool")).to.equal("ask")
	})

	it("keeps input enabled for follow_up even when button config disables sending", () => {
		const messages: DietCodeMessage[] = [{ type: "say", say: "text", text: "Done", ts: 1 }]
		expect(isChatInputEnabled(messages, undefined, { sendingDisabled: true })).to.equal(true)
	})

	it("blocks input when no route matches and buttons disable sending", () => {
		const messages: DietCodeMessage[] = [{ type: "ask", ask: "api_req_failed", ts: 1 }]
		expect(resolveChatSendRoute(messages, "api_req_failed")).to.equal("ask")
		expect(isChatInputEnabled(messages, "api_req_failed", { sendingDisabled: true })).to.equal(true)
	})
})
