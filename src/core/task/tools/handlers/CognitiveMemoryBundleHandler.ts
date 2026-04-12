import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryBundleHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_BUNDLE

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
