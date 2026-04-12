import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryChangelogHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_CHANGELOG

	getDescription(block: ToolUse): string {
		const { baseId, headId } = block.params as { baseId: string; headId: string }
		return `[generate cognitive changelog from ${baseId} to ${headId}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { baseId, headId } = block.params as { baseId: string; headId: string }
		if (!baseId || !headId) {
			return formatResponse.toolError("Both baseId and headId are required.")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const changelog = await kgService.generateChangelog(config.taskId, baseId, headId)
			return changelog
		} catch (error) {
			return formatResponse.toolError(`Failed to generate cognitive changelog: ${error}`)
		}
	}
}
