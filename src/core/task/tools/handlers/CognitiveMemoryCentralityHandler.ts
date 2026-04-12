import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryCentralityHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_CENTRALITY

	getDescription(_block: ToolUse): string {
		return "[get node centrality]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { id } = block.params as { id: string }
		if (!id) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "id")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const centrality = await kgService.getNodeCentrality(id)
			return JSON.stringify(centrality, null, 2)
		} catch (error) {
			return formatResponse.toolError(`Failed to calculate centrality: ${error}`)
		}
	}
}
