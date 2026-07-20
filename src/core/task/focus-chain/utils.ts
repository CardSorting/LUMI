import { isCompletedFocusChainItem, isFocusChainItem, parseFocusChainItem } from "@shared/focus-chain-utils"
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

/**
 * Merges the proposed checklist (from LLM tool response) into the current checklist (edited by the user).
 * Preserves user-added items and checklist modifications while carrying over completion checkboxes marked by the LLM.
 */
export function mergeFocusChainChecklists(currentList: string, proposedList: string): string {
	const currentLines = currentList.split("\n")
	const proposedLines = proposedList.split("\n")

	const currentItems = currentLines.map((line) => {
		const parsed = parseFocusChainItem(line.trim())
		return parsed ? { line, parsed } : { line, parsed: null }
	})

	const proposedItems: Array<{ checked: boolean; text: string }> = []
	const proposedMap = new Map<string, { checked: boolean; originalText: string }>()

	for (const line of proposedLines) {
		const parsed = parseFocusChainItem(line.trim())
		if (parsed) {
			const normalized = parsed.text.toLowerCase().replace(/\s+/g, " ").trim()
			proposedMap.set(normalized, { checked: parsed.checked, originalText: parsed.text })
			proposedItems.push(parsed)
		}
	}

	const matchedProposedNormalized = new Set<string>()

	const mergedLines = currentItems.map((item) => {
		if (item.parsed) {
			const normalized = item.parsed.text.toLowerCase().replace(/\s+/g, " ").trim()
			const proposed = proposedMap.get(normalized)
			if (proposed) {
				matchedProposedNormalized.add(normalized)
				const shouldBeChecked = item.parsed.checked || proposed.checked
				if (shouldBeChecked !== item.parsed.checked) {
					const checkboxIndex = item.line.indexOf("[")
					if (checkboxIndex !== -1 && item.line[checkboxIndex + 2] === "]") {
						return (
							item.line.slice(0, checkboxIndex + 1) +
							(shouldBeChecked ? "x" : " ") +
							item.line.slice(checkboxIndex + 2)
						)
					}
				}
			}
		}
		return item.line
	})

	for (const proposed of proposedItems) {
		const normalized = proposed.text.toLowerCase().replace(/\s+/g, " ").trim()
		if (!matchedProposedNormalized.has(normalized)) {
			const checkbox = proposed.checked ? "[x]" : "[ ]"
			mergedLines.push(`- ${checkbox} ${proposed.text}`)
		}
	}

	return mergedLines.join("\n")
}
