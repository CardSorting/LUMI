import { DietCodeDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { TaskConfig } from "../types/TaskConfig"
import { declareInternalStateIntent, IToolHandler } from "../types/ToolContracts"

export class CognitiveMemoryRefreshHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.MEM_REFRESH

	getApprovalIntent(block: ToolUse) {
		return declareInternalStateIntent(block, `Refresh durable cognitive node ${block.params.id ?? ""}`)
	}

	getDescription(_block: ToolUse): string {
		return "[refresh cognitive memory]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { id } = block.params as { id: string }
		if (!id) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "id", "")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			await kgService.refreshKnowledge(id)
			return `Successfully refreshed confidence for knowledge node ${id}.`
		} catch (error) {
			return formatResponse.toolError(
				`Failed to refresh knowledge node: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
