import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryContextHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_CONTEXT

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const path = block.params.path
		const limit = block.params.limit ? Number.parseInt(block.params.limit, 10) : 50

		if (!path) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		try {
			const context = await config.services.knowledgeGraphService.getContextGraph(config.taskId, path, limit)

			if (context.length === 0) {
				return formatResponse.toolResult(`No semantic correlations found for '${path}'.`)
			}

			const formatted = context.map((c) => `- ${c.path} (weight: ${c.weight})`).join("\n")

			return formatResponse.toolResult(
				`Semantic context for '${path}':\n\n${formatted}\n\nThese files are frequently co-modified based on task history.`,
			)
		} catch (error) {
			return `Error analyzing semantic context: ${(error as Error)?.message}`
		}
	}
}
