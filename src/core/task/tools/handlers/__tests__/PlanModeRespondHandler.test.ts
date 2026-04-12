import { expect } from "chai"
import { CodemarieDefaultTool } from "@/shared/tools"
import { PlanModeRespondHandler } from "../PlanModeRespondHandler"

describe("PlanModeRespondHandler - Exploration Limits", () => {
	let handler: PlanModeRespondHandler
	let mockTaskState: any
	let mockConfig: any

	beforeEach(() => {
		handler = new PlanModeRespondHandler()
		mockTaskState = {
			currentTurnExplorationCount: 0,
			consecutiveMistakeCount: 0,
		}
		mockConfig = {
			taskState: mockTaskState,
			mode: "plan",
			yoloModeToggled: false,
			callbacks: {
				sayAndCreateMissingParamError: async () => "error",
				ask: async () => ({ text: "ok", images: [], files: [] }),
			},
			messageState: {
				getApiConversationHistory: () => [],
				getCodemarieMessages: () => [],
			},
		}
	})

	it("should allow needs_more_exploration until threshold (3)", async () => {
		const block = {
			name: CodemarieDefaultTool.PLAN_MODE,
			params: {
				response: "I need to see more.",
				needs_more_exploration: "true",
			},
		}

		// 1st call
		let result = await handler.execute(mockConfig, block as any)
		expect(mockTaskState.currentTurnExplorationCount).to.equal(1)
		expect(result).to.contain("You have indicated that you need more exploration")

		// 2nd call
		result = await handler.execute(mockConfig, block as any)
		expect(mockTaskState.currentTurnExplorationCount).to.equal(2)
		expect(result).to.contain("You have indicated that you need more exploration")

		// 3rd call
		result = await handler.execute(mockConfig, block as any)
		expect(mockTaskState.currentTurnExplorationCount).to.equal(3)
		expect(result).to.contain("You have indicated that you need more exploration")

		// 4th call (threshold exceeded)
		result = await handler.execute(mockConfig, block as any)
		expect(mockTaskState.currentTurnExplorationCount).to.equal(4)
		expect(result).to.contain("⚠️ RECURSIVE EXPLORATION DETECTED")
	})
})
