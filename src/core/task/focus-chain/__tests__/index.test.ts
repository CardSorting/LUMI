import { expect } from "chai"
import { FocusChainPrompts } from "../prompts"
import { createFocusChainProgressGuidance } from "../utils"

describe("focus-chain progress guidance", () => {
	it("uses completion guidance when every progress item is done", () => {
		const instructions = createFocusChainProgressGuidance({
			totalItems: 2,
			completedItems: 2,
			currentFocusChainChecklist: "- [x] Audit the current behavior\n- [x] Validate the finished change",
		})

		expect(instructions).to.contain("All 2 items have been completed")
		expect(instructions).not.to.contain("Focus on finishing the remaining items")
	})

	it("keeps plan-mode checklist guidance optional", () => {
		expect(FocusChainPrompts.planModeReminder).to.contain("Optional - Plan Mode")
		expect(FocusChainPrompts.planModeReminder).to.contain("you may include a preliminary todo list")
	})
})
