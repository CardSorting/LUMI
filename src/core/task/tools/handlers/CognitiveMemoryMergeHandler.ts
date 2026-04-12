import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryMergeHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_MERGE

	getDescription(_block: ToolUse): string {
		return "[merge cognitive memory]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { sourceId, targetId } = block.params as { sourceId: string; targetId: string }

		if (!sourceId) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "sourceId", "")
		}
		if (!targetId) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "targetId", "")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			await kgService.mergeKnowledge(sourceId, targetId)
			return `Successfully merged knowledge node ${sourceId} into ${targetId}. All related edges have been re-pointed.`
		} catch (error) {
			return formatResponse.toolError(
				`Failed to merge knowledge nodes: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
