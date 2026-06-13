import { detectReplanIntent } from "./detectReplanIntent"
import type { DietCodeMessage } from "./ExtensionMessage"
import type { Mode } from "./storage/types"

/**
 * Infer the correct agent mode when resuming a task from saved messages.
 * - YOLO tasks always resume in act mode.
 * - After user feedback requesting replan, resume in plan mode (even if a plan was already delivered).
 * - After a finalized plan_summary, resume in act mode (implementation phase).
 * - Otherwise resume in plan mode (still exploring / planning).
 */
export function inferAgentModeFromMessages(messages: DietCodeMessage[], yoloModeToggled: boolean): Mode {
	if (yoloModeToggled) {
		return "act"
	}

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]

		if (message.type === "say" && message.say === "user_feedback" && detectReplanIntent(message.text)) {
			return "plan"
		}

		if (message.type === "say" && message.say === "plan_summary" && message.partial !== true) {
			return "act"
		}

		// Legacy blocking plan ask with stored response counts as plan delivered
		if (message.type === "ask" && message.ask === "plan_mode_respond" && message.partial !== true && message.text) {
			try {
				const parsed = JSON.parse(message.text) as { response?: string }
				if (parsed.response?.trim()) {
					return "act"
				}
			} catch {
				if (message.text.trim()) {
					return "act"
				}
			}
		}
	}

	return "plan"
}

/**
 * Drop incomplete plan_summary streaming rows so resume does not show a stale partial plan.
 */
export function stripPartialPlanSummaryMessages(messages: DietCodeMessage[]): DietCodeMessage[] {
	return messages.filter((message) => !(message.type === "say" && message.say === "plan_summary" && message.partial === true))
}
