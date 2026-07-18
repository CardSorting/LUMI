import type { DietCodeAsk, DietCodeMessage } from "@shared/ExtensionMessage"

export type TerminalCompletionEvidenceSource =
	| "durable_completion"
	| "completion_result"
	| "completion_funnel"
	| "completed_resume"

export interface TerminalCompletionEvidence {
	source: TerminalCompletionEvidenceSource
	messageIndex?: number
}

export type DurableTaskCompletionStatus = "succeeded" | "failed" | "cancelled"

function completionEvidenceFromMessage(message: DietCodeMessage): TerminalCompletionEvidenceSource | undefined {
	if (message.type === "ask" && message.ask === "resume_completed_task") {
		return "completed_resume"
	}
	if (message.ask === "completion_result" || message.say === "completion_result") {
		return "completion_result"
	}
	if (message.completionFunnelEvent?.terminal) {
		return "completion_funnel"
	}
	return undefined
}

/**
 * Resume buttons and post-result bookkeeping are presentation events, not new
 * execution. Only explicit user continuation or a new model turn reopens a
 * terminal task.
 */
function reopensCompletedTask(message: DietCodeMessage): boolean {
	if (message.type === "ask") {
		return !(message.ask === "completion_result" || message.ask === "resume_task" || message.ask === "resume_completed_task")
	}
	return (
		message.say === "task" ||
		message.say === "user_feedback" ||
		message.say === "user_feedback_diff" ||
		message.say === "api_req_started"
	)
}

/**
 * Returns the latest terminal completion evidence unless a later user/model
 * continuation explicitly reopened the task. This prevents a presentation-only
 * `resume_task` marker or older funnel observation from overturning an
 * already-recorded completion result.
 */
export function getTerminalCompletionEvidence(
	messages: readonly DietCodeMessage[],
	durableStatus?: DurableTaskCompletionStatus,
): TerminalCompletionEvidence | undefined {
	if (durableStatus === "succeeded") {
		return { source: "durable_completion" }
	}

	let latest: TerminalCompletionEvidence | undefined
	for (let index = 0; index < messages.length; index++) {
		const source = completionEvidenceFromMessage(messages[index])
		if (source) {
			latest = { source, messageIndex: index }
			continue
		}
		if (latest && reopensCompletedTask(messages[index])) {
			latest = undefined
		}
	}
	return latest
}

export function hasTerminalCompletionEvidence(
	messages: readonly DietCodeMessage[],
	durableStatus?: DurableTaskCompletionStatus,
): boolean {
	return getTerminalCompletionEvidence(messages, durableStatus) !== undefined
}

export function resolveTaskResumeAsk(
	messages: readonly DietCodeMessage[],
	durableStatus?: DurableTaskCompletionStatus,
): DietCodeAsk {
	return hasTerminalCompletionEvidence(messages, durableStatus) ? "resume_completed_task" : "resume_task"
}
