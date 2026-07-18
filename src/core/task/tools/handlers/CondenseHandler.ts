import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import {
	declareInternalStateIntent,
	type IPartialBlockHandler,
	type IToolHandler,
	type ToolResponse,
} from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class CondenseHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.CONDENSE

	getApprovalIntent(block: ToolUse) {
		return declareInternalStateIntent(block, "Replace the active conversation context with a condensed summary", {
			type: "condense",
			message: block.params.context ?? "",
			notification: "DietCode wants to condense the active conversation",
		})
	}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const context: string | undefined = block.params.context

		// Validate required parameters
		if (!context) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: context"
		}

		config.taskState.consecutiveMistakeCount = 0

		// ExecutionFunnel recorded explicit consent before this adapter was dispatched.
		const apiConversationHistory = config.messageState.getApiConversationHistory()
		const lastMessage = apiConversationHistory[apiConversationHistory.length - 1]
		const summaryAlreadyAppended = lastMessage && lastMessage.role === "assistant"
		const keepStrategy = summaryAlreadyAppended ? "lastTwo" : "none"

		// clear the context history at this point in time
		config.taskState.conversationHistoryDeletedRange = config.services.contextManager.getNextTruncationRange(
			apiConversationHistory,
			config.taskState.conversationHistoryDeletedRange,
			keepStrategy,
		)
		await config.messageState.saveDietCodeMessagesAndUpdateHistory()
		await config.services.contextManager.triggerApplyStandardContextTruncationNoticeChange(
			Date.now(),
			await ensureTaskDirectoryExists(config.taskId),
			apiConversationHistory,
		)

		return formatResponse.toolResult(formatResponse.condense())
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = block.params.context || ""
		const cleanedContext = uiHelpers.removeClosingTag(block, "context", context)

		await uiHelpers.say("text", cleanedContext, undefined, undefined, block.partial).catch(() => {})
	}
}
