import { expect } from "chai"
import sinon from "sinon"
import { DietCodeDefaultTool } from "@/shared/tools"
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
				say: sinon.stub().resolves(undefined),
				removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(undefined),
				updateFCListFromToolResponse: sinon.stub().resolves(undefined),
				switchToActMode: async () => true,
				switchToPlanMode: async () => false,
			},
			messageState: {
				getApiConversationHistory: () => [],
				getDietCodeMessages: () => [],
				saveDietCodeMessagesAndUpdateHistory: async () => undefined,
			},
		}
	})

	it("should auto-switch to act mode after presenting a finalized plan", async () => {
		const switchToActMode = sinon.stub().resolves(true)
		const say = sinon.stub().resolves(undefined)
		const removeLastPartialMessageIfExistsWithType = sinon.stub().resolves(undefined)
		mockConfig.callbacks.switchToActMode = switchToActMode
		mockConfig.callbacks.say = say
		mockConfig.callbacks.removeLastPartialMessageIfExistsWithType = removeLastPartialMessageIfExistsWithType

		const block = {
			name: DietCodeDefaultTool.PLAN_MODE,
			params: {
				response: "Here is the plan.",
			},
		}

		const result = await handler.execute(mockConfig, block as any)

		expect(removeLastPartialMessageIfExistsWithType.calledOnceWith("say", "plan_summary")).to.equal(true)
		expect(say.calledOnce).to.equal(true)
		expect(say.firstCall.args[0]).to.equal("plan_summary")
		expect(switchToActMode.calledOnce).to.equal(true)
		expect(mockConfig.taskState.didRespondToPlanAskBySwitchingMode).to.equal(true)
		expect(result).to.contain("Planning complete")
	})

	it("should allow needs_more_exploration until threshold (3)", async () => {
		const block = {
			name: DietCodeDefaultTool.PLAN_MODE,
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
