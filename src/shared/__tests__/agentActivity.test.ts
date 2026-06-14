import { expect } from "chai"
import { canSendSteeringMessage, canSendTaskFeedback, isApiRequestInProgress, isTaskInIdleGap } from "../agentActivity"
import type { DietCodeMessage } from "../ExtensionMessage"

describe("agentActivity", () => {
	describe("isApiRequestInProgress", () => {
		it("returns true when api request has no cost", () => {
			const message: DietCodeMessage = {
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: "test" }),
				ts: Date.now(),
			}
			expect(isApiRequestInProgress(message)).to.equal(true)
		})

		it("returns false when api request completed with cost", () => {
			const message: DietCodeMessage = {
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ cost: 0.01 }),
				ts: Date.now(),
			}
			expect(isApiRequestInProgress(message)).to.equal(false)
		})

		it("returns false when user cancelled", () => {
			const message: DietCodeMessage = {
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ cancelReason: "user_cancelled" }),
				ts: Date.now(),
			}
			expect(isApiRequestInProgress(message)).to.equal(false)
		})
	})

	describe("canSendSteeringMessage", () => {
		it("returns false when a blocking ask is active", () => {
			const messages: DietCodeMessage[] = [{ type: "say", say: "text", partial: true, ts: 1 }]
			expect(canSendSteeringMessage(messages, "tool")).to.equal(false)
		})

		it("returns true for partial streaming messages", () => {
			const messages: DietCodeMessage[] = [{ type: "say", say: "reasoning", partial: true, ts: 1 }]
			expect(canSendSteeringMessage(messages)).to.equal(true)
		})

		it("returns true for in-flight api requests", () => {
			const messages: DietCodeMessage[] = [
				{
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ request: "test" }),
					ts: 1,
				},
			]
			expect(canSendSteeringMessage(messages)).to.equal(true)
		})

		it("returns false for completed non-partial text messages", () => {
			const messages: DietCodeMessage[] = [{ type: "say", say: "text", text: "Done", ts: 1 }]
			expect(canSendSteeringMessage(messages)).to.equal(false)
		})
	})

	describe("canSendTaskFeedback", () => {
		it("returns true for active tasks without blocking asks", () => {
			const messages: DietCodeMessage[] = [{ type: "say", say: "text", text: "Done", ts: 1 }]
			expect(canSendTaskFeedback(messages)).to.equal(true)
		})

		it("returns false when an unanswered ask is the last message", () => {
			const messages: DietCodeMessage[] = [{ type: "ask", ask: "followup", ts: 1 }]
			expect(canSendTaskFeedback(messages)).to.equal(false)
		})

		it("returns false when completion ask is active", () => {
			const messages: DietCodeMessage[] = [{ type: "ask", ask: "completion_result", ts: 1 }]
			expect(canSendTaskFeedback(messages, "completion_result")).to.equal(false)
		})

		it("returns false when another blocking ask requires the ask path", () => {
			const messages: DietCodeMessage[] = [{ type: "ask", ask: "tool", ts: 1 }]
			expect(canSendTaskFeedback(messages, "tool")).to.equal(false)
		})
	})

	describe("isTaskInIdleGap", () => {
		it("returns true between completed turns", () => {
			const messages: DietCodeMessage[] = [{ type: "say", say: "text", text: "Done", ts: 1 }]
			expect(isTaskInIdleGap(messages)).to.equal(true)
		})

		it("returns false during streaming", () => {
			const messages: DietCodeMessage[] = [{ type: "say", say: "text", partial: true, ts: 1 }]
			expect(isTaskInIdleGap(messages)).to.equal(false)
		})
	})
})
