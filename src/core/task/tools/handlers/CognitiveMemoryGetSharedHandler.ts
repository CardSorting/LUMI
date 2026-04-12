import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryGetSharedHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_GET_SHARED

	getDescription(_block: ToolUse): string {
		return "[get shared memory layer]"
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<any> {
		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const memories = await kgService.getSharedMemory(config.taskId)
			if (memories.length === 0) return "Shared memory layer is empty."
			return memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
		} catch (error) {
			return formatResponse.toolError(`Failed to fetch shared memory: ${error}`)
		}
	}
}
