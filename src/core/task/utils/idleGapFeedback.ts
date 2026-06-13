import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import type { DietCodeContent } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import type { TaskState } from "../TaskState"
import { buildSteeringUserContent, hasSteeringFeedback, type PendingSteeringFeedback } from "./steeringInterrupt"

export type { PendingSteeringFeedback }

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
	isTaskInitialized: boolean
	abort: boolean
}): boolean {
	if (params.abort || !params.isTaskInitialized) {
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

export async function consumeIdleGapFeedback(params: {
	taskState: TaskState
	mode: Mode
	yoloModeToggled: boolean
	switchToPlanMode: () => Promise<boolean>
	say: (type: "user_feedback" | "info", text?: string, images?: string[], files?: string[]) => Promise<number | undefined>
}): Promise<DietCodeContent[] | null> {
	if (!params.taskState.idleGapFeedbackRequested || !hasSteeringFeedback(params.taskState.pendingIdleGapFeedback)) {
		return null
	}

	const feedback = params.taskState.pendingIdleGapFeedback!
	params.taskState.idleGapFeedbackRequested = false
	params.taskState.pendingIdleGapFeedback = undefined

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

	return buildSteeringUserContent({
		feedback,
		mode: params.mode,
	})
}
