import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemorySubgraphHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_SUBGRAPH

	getDescription(_block: ToolUse): string {
		return "[extract knowledge subgraph]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { id, rootId, maxDepth } = block.params as { id?: string; rootId?: string; maxDepth?: string }
		const targetId = id || rootId
		const depth = Number.parseInt(maxDepth || "2", 10)

		if (!targetId) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "id")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const subgraph = await kgService.extractSubgraph(targetId, depth)
			return JSON.stringify(subgraph, null, 2)
		} catch (error) {
			return formatResponse.toolError(`Failed to extract subgraph: ${error}`)
		}
	}
}
