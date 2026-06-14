import { buildUserFeedbackContent } from "@core/task/utils/buildUserFeedbackContent"
import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import type { DietCodeMessageModelInfo } from "@shared/messages"
import type { DietCodeContent } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import type { MessageStateHandler } from "../message-state"
import type { TaskState } from "../TaskState"

export type PendingSteeringFeedback = {
	text?: string
	images?: string[]
	files?: string[]
}

export function hasSteeringFeedback(feedback?: PendingSteeringFeedback): boolean {
	if (!feedback) return false
	return Boolean(feedback.text?.trim() || feedback.images?.length || feedback.files?.length)
}

/** Coalesce rapid follow-ups into one API turn while keeping each message visible in chat. */
export function mergeSteeringFeedback(
	existing: PendingSteeringFeedback,
	incoming: PendingSteeringFeedback,
): PendingSteeringFeedback {
	const texts = [existing.text?.trim(), incoming.text?.trim()].filter(Boolean)
	return {
		text: texts.length > 0 ? texts.join("\n\n") : undefined,
		images: [...(existing.images ?? []), ...(incoming.images ?? [])],
		files: [...(existing.files ?? []), ...(incoming.files ?? [])],
	}
}

export function shouldAcceptSteeringInterrupt(params: {
	askResponse: string
	feedback?: PendingSteeringFeedback
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	hasUnansweredAsk: boolean
}): boolean {
	if (params.askResponse !== "messageResponse") return false
	if (!hasSteeringFeedback(params.feedback)) return false
	if (params.hasUnansweredAsk) return false
	return params.isStreaming || params.isWaitingForFirstChunk
}

export async function buildSteeringUserContent(params: {
	feedback: PendingSteeringFeedback
	mode: Mode
}): Promise<DietCodeContent[]> {
	const { text, images, files } = params.feedback
	const blocks = await buildUserFeedbackContent(text, images, files)
	const modeHint =
		params.mode === "plan"
			? "Respond with plan_mode_respond if you are presenting an updated plan, otherwise continue exploring with read-only tools."
			: "Adjust your approach based on this feedback and continue with your next substantive tool call."

	blocks.push({
		type: "text",
		text: `[The user sent new instructions while you were working. ${modeHint}]`,
	})

	return blocks
}

export async function consumeSteeringInterrupt(params: {
	taskState: TaskState
	mode: Mode
	yoloModeToggled: boolean
	switchToPlanMode: () => Promise<boolean>
	say: (type: "user_feedback" | "info", text?: string, images?: string[], files?: string[]) => Promise<number | undefined>
}): Promise<DietCodeContent[] | null> {
	if (!params.taskState.steeringInterruptRequested || !hasSteeringFeedback(params.taskState.pendingSteeringFeedback)) {
		return null
	}

	const feedback = params.taskState.pendingSteeringFeedback!
	params.taskState.steeringInterruptRequested = false
	params.taskState.pendingSteeringFeedback = undefined

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

export async function appendInterruptedAssistantTurn(params: {
	messageStateHandler: MessageStateHandler
	assistantTextOnly: string
	modelInfo: DietCodeMessageModelInfo
	taskMetrics: {
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
		totalCost: number | undefined
	}
	interruptLabel?: string
}): Promise<void> {
	const label = params.interruptLabel ?? "Response interrupted by user steering"
	const apiText = params.assistantTextOnly.trim() ? `${params.assistantTextOnly}\n\n[${label}]` : `[${label}]`

	await params.messageStateHandler.addToApiConversationHistory({
		role: "assistant",
		content: [{ type: "text", text: apiText }],
		modelInfo: params.modelInfo,
		metrics: {
			tokens: {
				prompt: params.taskMetrics.inputTokens,
				completion: params.taskMetrics.outputTokens,
				cached: params.taskMetrics.cacheWriteTokens + params.taskMetrics.cacheReadTokens,
			},
			cost: params.taskMetrics.totalCost,
		},
		ts: Date.now(),
	})
}
