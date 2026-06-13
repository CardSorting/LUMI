import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { FocusChainPrompts } from "./prompts"

export interface TodoListCounts {
	totalItems: number
	completedItems: number
}

export interface FocusChainProgressGuidanceInput extends TodoListCounts {
	currentFocusChainChecklist: string
}

/**
 * Parses a focus chain list string and returns counts of total and completed items
 * @param todoList The focus chain list string to parse
 * @returns Object with totalItems and completedItems counts
 */
export function parseFocusChainListCounts(todoList: string): TodoListCounts {
	const lines = todoList.split("\n")
	let totalItems = 0
	let completedItems = 0

	for (const line of lines) {
		const trimmed = line.trim()
		if (isFocusChainItem(trimmed)) {
			totalItems++
			if (isCompletedFocusChainItem(trimmed)) {
				completedItems++
			}
		}
	}

	return { totalItems, completedItems }
}

export function createFocusChainProgressGuidance({
	totalItems,
	completedItems,
	currentFocusChainChecklist,
}: FocusChainProgressGuidanceInput): string {
	if (totalItems <= 0) return ""

	const percentComplete = Math.round((completedItems / totalItems) * 100)
	if (completedItems === totalItems) {
		return FocusChainPrompts.completed
			.replace("{{totalItems}}", totalItems.toString())
			.replace("{{currentFocusChainChecklist}}", currentFocusChainChecklist)
	}

	if (completedItems === 0) {
		return "\n\n**Note:** No items are marked complete yet. As you work through the task, remember to mark items as complete when finished."
	}

	if (percentComplete >= 25 && percentComplete < 50) {
		return `\n\n**Note:** ${percentComplete}% of items are complete.`
	}

	if (percentComplete >= 50 && percentComplete < 75) {
		return `\n\n**Note:** ${percentComplete}% of items are complete. Proceed with the task.`
	}

	if (percentComplete >= 75) {
		return `\n\n**Note:** ${percentComplete}% of items are complete. Focus on finishing the remaining items.`
	}

	return ""
}
