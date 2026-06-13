import { buildSteeringUserContent, hasSteeringFeedback, shouldAcceptSteeringInterrupt } from "@core/task/utils/steeringInterrupt"
import { expect } from "chai"

describe("steeringInterrupt", () => {
	it("accepts steering only during active work without an open ask", () => {
		expect(
			shouldAcceptSteeringInterrupt({
				askResponse: "messageResponse",
				feedback: { text: "Use a different approach" },
				isStreaming: true,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: false,
			}),
		).to.equal(true)

		expect(
			shouldAcceptSteeringInterrupt({
				askResponse: "messageResponse",
				feedback: { text: "Use a different approach" },
				isStreaming: false,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: false,
			}),
		).to.equal(false)

		expect(
			shouldAcceptSteeringInterrupt({
				askResponse: "messageResponse",
				feedback: { text: "Approve" },
				isStreaming: true,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: true,
			}),
		).to.equal(false)
	})

	it("builds mode-aware steering instructions", async () => {
		const actContent = await buildSteeringUserContent({
			feedback: { text: "Focus on tests first" },
			mode: "act",
		})
		expect(actContent.some((block) => block.type === "text" && block.text.includes("next substantive tool call"))).to.equal(
			true,
		)

		const planContent = await buildSteeringUserContent({
			feedback: { text: "Let's replan" },
			mode: "plan",
		})
		expect(planContent.some((block) => block.type === "text" && block.text.includes("plan_mode_respond"))).to.equal(true)
	})

	it("detects meaningful steering payloads", () => {
		expect(hasSteeringFeedback({ text: "hello" })).to.equal(true)
		expect(hasSteeringFeedback({ images: ["img"] })).to.equal(true)
		expect(hasSteeringFeedback({ text: "   " })).to.equal(false)
	})
})
