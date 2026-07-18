import { DietCodeDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { TaskConfig } from "../types/TaskConfig"
import { declareNoConsentIntent, IToolHandler } from "../types/ToolContracts"

export class CognitiveMemoryBundleHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.MEM_BUNDLE

	getApprovalIntent(block: ToolUse) {
		return declareNoConsentIntent(block, "Read the task cognitive intelligence bundle")
	}

	getDescription(_block: ToolUse): string {
		return "[fetch cognitive intelligence bundle]"
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<any> {
		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const bundle = await kgService.getAgentBundle(config.taskId)
			return `Successfully fetched cognitive bundle:\n\n${JSON.stringify(bundle, null, 2)}`
		} catch (error) {
			return formatResponse.toolError(`Failed to fetch cognitive bundle: ${error}`)
		}
	}
}
