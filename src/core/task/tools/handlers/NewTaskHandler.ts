import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import {
	declareInternalStateIntent,
	type IPartialBlockHandler,
	type IToolHandler,
	type ToolResponse,
} from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class NewTaskHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.NEW_TASK

	getApprovalIntent(block: ToolUse) {
		return declareInternalStateIntent(block, "Create a new task from the proposed context", {
			type: this.name,
			message: block.params.context ?? "",
			notification: "DietCode wants to create a new task",
		})
	}

	getDescription(block: ToolUse): string {
		return `[${block.name} for creating a new task]`
	}

	/**
	 * Handle partial block streaming for new_task
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = uiHelpers.removeClosingTag(block, "context", block.params.context)
		await uiHelpers.say("text", context, undefined, undefined, true).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const context: string | undefined = block.params.context

		// Validate required parameters
		if (!context) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "context")
		}

		config.taskState.consecutiveMistakeCount = 0

		// ExecutionFunnel recorded explicit consent before this adapter was dispatched.
		return formatResponse.toolResult(`The user has created a new task with the provided context.`)
	}
}
