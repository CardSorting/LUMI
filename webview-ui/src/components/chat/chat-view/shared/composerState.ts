import { canSendSteeringMessage } from "@shared/agentActivity"
import type { DietCodeMessage } from "@shared/ExtensionMessage"

export type ComposerMode = "ready" | "steering" | "recovering" | "resume" | "approval" | "completion" | "disabled"

const APPROVAL_ASKS = new Set<DietCodeMessage["ask"]>([
	"tool",
	"command",
	"command_output",
	"browser_action_launch",
	"use_mcp_server",
	"use_subagents",
])

export function deriveComposerMode(
	messages: DietCodeMessage[],
	dietcodeAsk: DietCodeMessage["ask"] | null | undefined,
	inputEnabled: boolean,
): ComposerMode {
	if (!inputEnabled) return "disabled"
	const lastMessage = messages.at(-1)
	if (lastMessage?.type === "say" && lastMessage.say === "api_req_started") {
		try {
			const info = JSON.parse(lastMessage.text || "{}") as { cancelReason?: string }
			if (info.cancelReason === "user_cancelled") return "resume"
		} catch {
			// Malformed legacy payloads remain in the normal composer state.
		}
	}
	if (lastMessage?.type === "ask" && APPROVAL_ASKS.has(lastMessage.ask)) return "approval"
	if (
		lastMessage?.ask === "completion_result" ||
		lastMessage?.ask === "resume_completed_task" ||
		lastMessage?.say === "completion_result"
	) {
		return "completion"
	}
	if (lastMessage?.say === "api_req_retried" || lastMessage?.say === "error_retry") return "recovering"
	if (canSendSteeringMessage(messages, dietcodeAsk)) return "steering"
	return "ready"
}

export function shouldCollapseComposer(mode: ComposerMode, hasDraft: boolean, hasActiveQuote: boolean): boolean {
	return (mode === "approval" || mode === "recovering" || mode === "completion") && !hasDraft && !hasActiveQuote
}
