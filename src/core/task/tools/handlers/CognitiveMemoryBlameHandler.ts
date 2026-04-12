import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryBlameHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_BLAME

	getDescription(block: ToolUse): string {
		return `[blame cognitive memory for '${block.params.path}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { path } = block.params as { path: string }
		if (!path) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const blameInfo = await kgService.blame(config.taskId, path)
			if (!blameInfo) {
				return `No historical modification record found for '${path}'.`
			}

			return `Blame for '${path}':\n\nLast modified by: ${blameInfo.lastAuthor}\nNode ID: ${blameInfo.lastNodeId}\nMessage: ${blameInfo.lastMessage}\nTime: ${new Date(blameInfo.lastTimestamp).toISOString()}`
		} catch (error) {
			return formatResponse.toolError(`Failed to fetch blame info: ${error}`)
		}
	}
}
