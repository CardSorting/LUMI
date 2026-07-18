import { canSendSteeringMessage } from "@shared/agentActivity"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { TaskLifecycleEvent } from "@shared/lifecycle/taskLifecycleEvent"

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
	lifecycleEvent?: TaskLifecycleEvent,
): ComposerMode {
	if (!inputEnabled) return "disabled"
	if (lifecycleEvent?.committed.state === "terminal") {
		return lifecycleEvent.committed.terminalOutcome === "completed" ? "completion" : "resume"
	}
	const lastMessage = messages.at(-1)
	if (lastMessage?.type === "ask" && APPROVAL_ASKS.has(lastMessage.ask)) return "approval"
	if (lastMessage?.say === "api_req_retried" || lastMessage?.say === "error_retry") return "recovering"
	if (canSendSteeringMessage(messages, dietcodeAsk)) return "steering"
	return "ready"
}

export function shouldCollapseComposer(mode: ComposerMode, hasDraft: boolean, hasActiveQuote: boolean): boolean {
	return (mode === "approval" || mode === "recovering" || mode === "completion") && !hasDraft && !hasActiveQuote
}
