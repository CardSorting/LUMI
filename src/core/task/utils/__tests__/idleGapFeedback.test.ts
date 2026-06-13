import { TaskState } from "@core/task/TaskState"
import { consumeIdleGapFeedback, shouldAcceptIdleGapFeedback } from "@core/task/utils/idleGapFeedback"
import { expect } from "chai"

describe("idleGapFeedback", () => {
	it("accepts feedback between turns but not during streaming or open asks", () => {
		expect(
			shouldAcceptIdleGapFeedback({
				askResponse: "messageResponse",
				feedback: { text: "Try another approach" },
				isStreaming: false,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: false,
				isTaskInitialized: true,
				abort: false,
			}),
		).to.equal(true)

		expect(
			shouldAcceptIdleGapFeedback({
				askResponse: "messageResponse",
				feedback: { text: "Try another approach" },
				isStreaming: true,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: false,
				isTaskInitialized: true,
				abort: false,
			}),
		).to.equal(false)

		expect(
			shouldAcceptIdleGapFeedback({
				askResponse: "messageResponse",
				feedback: { text: "Try another approach" },
				isStreaming: false,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: true,
				isTaskInitialized: true,
				abort: false,
			}),
		).to.equal(false)
	})

	it("consumes queued idle-gap feedback into user content", async () => {
		const taskState = new TaskState()
		taskState.idleGapFeedbackRequested = true
		taskState.pendingIdleGapFeedback = { text: "Focus on tests first" }

		const sayCalls: string[] = []
		const content = await consumeIdleGapFeedback({
			taskState,
			mode: "act",
			yoloModeToggled: false,
			switchToPlanMode: async () => true,
			say: async (type, text) => {
				sayCalls.push(`${type}:${text ?? ""}`)
				return 1
			},
		})

		expect(content).to.not.equal(null)
		expect(taskState.idleGapFeedbackRequested).to.equal(false)
		expect(taskState.pendingIdleGapFeedback).to.equal(undefined)
		expect(sayCalls.some((entry) => entry.startsWith("user_feedback:"))).to.equal(true)
		expect(content!.some((block) => block.type === "text" && block.text.includes("Focus on tests first"))).to.equal(true)
	})
})
