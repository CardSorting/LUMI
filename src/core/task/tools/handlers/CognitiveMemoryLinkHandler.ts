import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryLinkHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_LINK

	getDescription(_block: ToolUse): string {
		return "[link cognitive memory nodes]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { sourceId, targetId, relation, weight } = block.params as {
			sourceId: string
			targetId: string
			relation: string
			weight?: number
		}

		if (!sourceId || !targetId || !relation) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "sourceId, targetId, or relation")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			await kgService.addEdge(sourceId, targetId, relation, weight || 1.0)
			return `Successfully linked cognitive nodes: ${sourceId} --(${relation})--> ${targetId}`
		} catch (error) {
			return formatResponse.toolError(`Failed to link cognitive memory nodes: ${error}`)
		}
	}
}
