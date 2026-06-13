import type { TaskConfig } from "../types/TaskConfig"

const TASK_PREVIEW_MAX_CHARS = 8000

export function getInitialTaskPreview(config: TaskConfig): string | undefined {
	const firstTaskMessage = config.messageState
		.getDietCodeMessages()
		.find((message) => message.say === "task")
		?.text?.trim()
	if (!firstTaskMessage) {
		return undefined
	}
	if (firstTaskMessage.length <= TASK_PREVIEW_MAX_CHARS) {
		return firstTaskMessage
	}
	return `${firstTaskMessage.slice(0, TASK_PREVIEW_MAX_CHARS)}\n...[truncated]`
}
