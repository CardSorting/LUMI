import type { DietCodeMessage } from "./ExtensionMessage"

const BLOCKING_TASK_ASKS = new Set<DietCodeMessage["ask"]>(["completion_result", "resume_task", "resume_completed_task"])

export function isBlockingTaskAsk(dietcodeAsk?: DietCodeMessage["ask"] | null): boolean {
	return dietcodeAsk != null && BLOCKING_TASK_ASKS.has(dietcodeAsk)
}

/**
 * Whether the latest api_req_started row is still in flight (no cost / not cancelled).
 */
export function isApiRequestInProgress(message: DietCodeMessage): boolean {
	if (message.type !== "say" || message.say !== "api_req_started") {
		return false
	}

	try {
		const info = JSON.parse(message.text || "{}") as { cost?: number; cancelReason?: string }
		if (info.cancelReason === "user_cancelled") {
			return false
		}
		return info.cost == null
	} catch {
		return true
	}
}

/**
 * True when the user can send mid-stream steering feedback (no blocking ask).
 * Mirrors Cursor-style "message while agent works" ergonomics.
 */
export function canSendSteeringMessage(messages: DietCodeMessage[], dietcodeAsk?: DietCodeMessage["ask"] | null): boolean {
	if (dietcodeAsk) {
		return false
	}
	if (messages.length === 0) {
		return false
	}

	const lastMessage = messages[messages.length - 1]

	if (lastMessage.partial === true) {
		return true
	}

	if (lastMessage.type === "say" && lastMessage.say === "api_req_started") {
		return isApiRequestInProgress(lastMessage)
	}

	return false
}

/**
 * True when the user can send follow-up feedback on an active task (including idle gaps between turns).
 * Blocking asks (tool approval, completion, resume) still route through the ask path.
 */
export function canSendTaskFeedback(messages: DietCodeMessage[], dietcodeAsk?: DietCodeMessage["ask"] | null): boolean {
	if (isBlockingTaskAsk(dietcodeAsk)) {
		return false
	}
	if (dietcodeAsk) {
		return false
	}
	return messages.length > 0
}

/** True when the input should show steering/follow-up placeholder copy. */
export function isAgentActiveForPlaceholder(messages: DietCodeMessage[], dietcodeAsk?: DietCodeMessage["ask"] | null): boolean {
	return canSendSteeringMessage(messages, dietcodeAsk) || canSendTaskFeedback(messages, dietcodeAsk)
}
