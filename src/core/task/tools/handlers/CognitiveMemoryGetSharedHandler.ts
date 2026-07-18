import { DietCodeDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { TaskConfig } from "../types/TaskConfig"
import { declareNoConsentIntent, IToolHandler } from "../types/ToolContracts"

export class CognitiveMemoryGetSharedHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.MEM_GET_SHARED

	getApprovalIntent(block: ToolUse) {
		return declareNoConsentIntent(block, "Read the shared cognitive memory layer")
	}

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
