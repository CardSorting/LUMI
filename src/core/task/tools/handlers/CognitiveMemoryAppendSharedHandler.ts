import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryAppendSharedHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_APPEND_SHARED

	getDescription(_block: ToolUse): string {
		return "[append to shared memory layer]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { content, memory } = block.params as { content?: string; memory?: string }
		const sharedMemory = content || memory

		if (!sharedMemory) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "content")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			await kgService.appendSharedMemory(config.taskId, sharedMemory)
			return "Successfully appended to shared memory layer."
		} catch (error) {
			return formatResponse.toolError(`Failed to append shared memory: ${error}`)
		}
	}
}
