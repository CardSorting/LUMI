import type { TaskConfig } from "../types/TaskConfig"
import { getCachedCompletionFunnelEvent } from "./CompletionFunnel"

export function shouldRejectFakeFollowupQuestion(config: TaskConfig): string | null {
	const event = getCachedCompletionFunnelEvent(config)
	if (!event) {
		return null
	}

	if (event.terminal) {
		return "Follow-up question not allowed — completion is committed and the session is complete."
	}

	if (event.nextAllowedAction === "modify_workspace") {
		return "Follow-up question not allowed — modify the workspace before retrying completion."
	}

	if (event.nextAllowedAction === "stop_and_report") {
		return "Follow-up question not allowed — stop and report the blocking funnel evidence."
	}

	return null
}
