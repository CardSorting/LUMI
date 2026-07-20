import { expect } from "chai"
import { FocusChainPrompts } from "../prompts"
import { createFocusChainProgressGuidance, mergeFocusChainChecklists } from "../utils"

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

describe("mergeFocusChainChecklists", () => {
	it("merges proposed list checked items into user updated list", () => {
		const currentList = "- [ ] Implement collision handling\n- [ ] Add new kart models\n- [ ] User added item"
		const proposedList = "- [x] Implement collision handling\n- [ ] Add new kart models"
		const result = mergeFocusChainChecklists(currentList, proposedList)

		expect(result).to.equal("- [x] Implement collision handling\n- [ ] Add new kart models\n- [ ] User added item")
	})

	it("keeps user checklist updates intact if proposed list does not check anything", () => {
		const currentList = "- [ ] Implement collision handling\n- [ ] Add new kart models\n- [ ] User added item"
		const proposedList = "- [ ] Implement collision handling\n- [ ] Add new kart models"
		const result = mergeFocusChainChecklists(currentList, proposedList)

		expect(result).to.equal(currentList)
	})
})
