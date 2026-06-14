import { buildUserFeedbackContent } from "@core/task/utils/buildUserFeedbackContent"
import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import type { DietCodeContent } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import type { TaskState } from "../TaskState"
import { hasSteeringFeedback, mergeSteeringFeedback, type PendingSteeringFeedback } from "./steeringInterrupt"

export type { PendingSteeringFeedback }

function idleGapModeHint(mode: Mode): string {
	return mode === "plan"
		? "Respond with plan_mode_respond if you are presenting an updated plan, otherwise continue exploring with read-only tools."
		: "Adjust your approach based on this feedback and continue with your next substantive tool call."
}

export type IdleGapFeedbackContext = {
	taskState: TaskState
	mode: Mode
	yoloModeToggled: boolean
	switchToPlanMode: () => Promise<boolean>
	say: (type: "user_feedback" | "info", text?: string, images?: string[], files?: string[]) => Promise<number | undefined>
}

/**
 * Accept feedback between agent turns — after a response completes and before the next API request.
 * Mid-stream feedback is handled separately by steeringInterrupt.
 */
export function shouldAcceptIdleGapFeedback(params: {
	askResponse: string
	feedback?: PendingSteeringFeedback
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	hasUnansweredAsk: boolean
	taskHasMessages: boolean
	abort: boolean
}): boolean {
	if (params.abort || !params.taskHasMessages) {
		return false
	}
	if (params.askResponse !== "messageResponse") {
		return false
	}
	if (!hasSteeringFeedback(params.feedback)) {
		return false
	}
	if (params.hasUnansweredAsk) {
		return false
	}
	if (params.isStreaming || params.isWaitingForFirstChunk) {
		return false
	}
	return true
}

/**
 * Immediately surfaces user feedback in the chat and queues it for the next API turn.
 * Industry pattern: message appears instantly; agent picks it up on the next loop iteration.
 */
export async function queueIdleGapFeedback(
	params: IdleGapFeedbackContext & { feedback: PendingSteeringFeedback },
): Promise<void> {
	const existing = params.taskState.pendingIdleGapFeedback
	if (hasSteeringFeedback(existing)) {
		params.taskState.pendingIdleGapFeedback = mergeSteeringFeedback(existing!, params.feedback)
	} else {
		params.taskState.pendingIdleGapFeedback = params.feedback
	}
	params.taskState.idleGapFeedbackRequested = true

	await params.say("user_feedback", params.feedback.text, params.feedback.images, params.feedback.files)
	params.taskState.idleGapFeedbackAcknowledged = true

	await maybeTransitionToReplanMode({
		feedback: params.feedback.text,
		currentMode: params.mode,
		yoloModeToggled: params.yoloModeToggled,
		switchToPlanMode: params.switchToPlanMode,
		sayInfo: async (message) => {
			await params.say("info", message)
		},
	})
}

export async function buildIdleGapUserContent(params: {
	feedback: PendingSteeringFeedback
	mode: Mode
}): Promise<DietCodeContent[]> {
	const { text, images, files } = params.feedback
	const blocks = await buildUserFeedbackContent(text, images, files)
	blocks.push({
		type: "text",
		text: `[The user sent follow-up instructions between turns. ${idleGapModeHint(params.mode)}]`,
	})
	return blocks
}

export async function consumeIdleGapFeedback(params: IdleGapFeedbackContext): Promise<DietCodeContent[] | null> {
	if (!params.taskState.idleGapFeedbackRequested || !hasSteeringFeedback(params.taskState.pendingIdleGapFeedback)) {
		return null
	}

	const feedback = params.taskState.pendingIdleGapFeedback!
	const alreadyAcknowledged = params.taskState.idleGapFeedbackAcknowledged
	params.taskState.idleGapFeedbackRequested = false
	params.taskState.pendingIdleGapFeedback = undefined
	params.taskState.idleGapFeedbackAcknowledged = false

	if (!alreadyAcknowledged) {
		await params.say("user_feedback", feedback.text, feedback.images, feedback.files)

		await maybeTransitionToReplanMode({
			feedback: feedback.text,
			currentMode: params.mode,
			yoloModeToggled: params.yoloModeToggled,
			switchToPlanMode: params.switchToPlanMode,
			sayInfo: async (message) => {
				await params.say("info", message)
			},
		})
	}

	return buildIdleGapUserContent({
		feedback,
		mode: params.mode,
	})
}
