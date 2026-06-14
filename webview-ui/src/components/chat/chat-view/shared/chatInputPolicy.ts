import { canSendTaskFeedback } from "@shared/agentActivity"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { ButtonConfig } from "./buttonConfig"

export type ChatSendRoute = "new_task" | "ask" | "follow_up" | "none"

export type ChatSendRouteOptions = {
	/** When false, follow-up messages are blocked (no live task controller). */
	taskSessionActive?: boolean
}

/**
 * Determines how the chat input should route an outgoing message.
 * Single source of truth for useMessageHandlers and input enablement.
 */
export function resolveChatSendRoute(
	messages: DietCodeMessage[],
	dietcodeAsk?: DietCodeMessage["ask"] | null,
	options?: ChatSendRouteOptions,
): ChatSendRoute {
	if (messages.length === 0) {
		return "new_task"
	}
	if (options?.taskSessionActive === false) {
		return "none"
	}
	if (dietcodeAsk) {
		return "ask"
	}
	if (canSendTaskFeedback(messages, dietcodeAsk)) {
		return "follow_up"
	}
	return "none"
}

/**
 * Whether the text field and send button should accept user input.
 * Overrides stale sendingDisabled when follow-up / steering is allowed.
 */
export function isChatInputEnabled(
	messages: DietCodeMessage[],
	dietcodeAsk?: DietCodeMessage["ask"] | null,
	buttonConfig?: Pick<ButtonConfig, "sendingDisabled">,
	options?: ChatSendRouteOptions,
): boolean {
	const route = resolveChatSendRoute(messages, dietcodeAsk, options)
	if (route === "follow_up" || route === "ask" || route === "new_task") {
		return true
	}
	return buttonConfig ? !buttonConfig.sendingDisabled : false
}
