import { TaskState } from "@core/task/TaskState"
import { consumeIdleGapFeedback, queueIdleGapFeedback, shouldAcceptIdleGapFeedback } from "@core/task/utils/idleGapFeedback"
import { mergeSteeringFeedback } from "@core/task/utils/steeringInterrupt"
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
				taskHasMessages: true,
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
				taskHasMessages: true,
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
				taskHasMessages: true,
				abort: false,
			}),
		).to.equal(false)

		expect(
			shouldAcceptIdleGapFeedback({
				askResponse: "messageResponse",
				feedback: { text: "Try another approach" },
				isStreaming: false,
				isWaitingForFirstChunk: false,
				hasUnansweredAsk: false,
				taskHasMessages: false,
				abort: false,
			}),
		).to.equal(false)
	})

	it("queues feedback immediately for chat visibility", async () => {
		const taskState = new TaskState()
		const sayCalls: string[] = []

		await queueIdleGapFeedback({
			taskState,
			feedback: { text: "Focus on tests first" },
			mode: "act",
			yoloModeToggled: false,
			switchToPlanMode: async () => true,
			say: async (type, text) => {
				sayCalls.push(`${type}:${text ?? ""}`)
				return 1
			},
		})

		expect(taskState.idleGapFeedbackRequested).to.equal(true)
		expect(taskState.idleGapFeedbackAcknowledged).to.equal(true)
		expect(taskState.pendingIdleGapFeedback?.text).to.equal("Focus on tests first")
		expect(sayCalls.some((entry) => entry.startsWith("user_feedback:"))).to.equal(true)
	})

	it("consumes queued idle-gap feedback into user content without duplicate user_feedback", async () => {
		const taskState = new TaskState()
		taskState.idleGapFeedbackRequested = true
		taskState.idleGapFeedbackAcknowledged = true
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
		expect(sayCalls.length).to.equal(0)
		expect(content!.some((block) => block.type === "text" && block.text.includes("Focus on tests first"))).to.equal(true)
		expect(content!.some((block) => block.type === "text" && block.text.includes("between turns"))).to.equal(true)
	})

	it("coalesces rapid follow-ups into one pending payload", async () => {
		const taskState = new TaskState()
		const sayCalls: string[] = []

		const context = {
			taskState,
			mode: "act" as const,
			yoloModeToggled: false,
			switchToPlanMode: async () => true,
			say: async (type: "user_feedback" | "info", text?: string) => {
				sayCalls.push(`${type}:${text ?? ""}`)
				return 1
			},
		}

		await queueIdleGapFeedback({ ...context, feedback: { text: "First note" } })
		await queueIdleGapFeedback({ ...context, feedback: { text: "Second note" } })

		expect(taskState.pendingIdleGapFeedback?.text).to.equal("First note\n\nSecond note")
		expect(sayCalls.filter((entry) => entry.startsWith("user_feedback:")).length).to.equal(2)
	})

	it("mergeSteeringFeedback joins text and concatenates attachments", () => {
		const merged = mergeSteeringFeedback({ text: "A", images: ["img1"] }, { text: "B", images: ["img2"], files: ["file1"] })
		expect(merged.text).to.equal("A\n\nB")
		expect(merged.images).to.deep.equal(["img1", "img2"])
		expect(merged.files).to.deep.equal(["file1"])
	})
})
