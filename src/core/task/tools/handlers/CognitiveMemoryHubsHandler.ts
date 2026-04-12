import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryHubsHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_HUBS

	getDescription(_block: ToolUse): string {
		return "Identify highly-connected 'Hub' nodes in the Knowledge Graph for rapid context indexing."
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { limit } = block.params as { limit?: number }
		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return "Knowledge Graph service is not available."
		}

		try {
			const hubs = await (kgService as any).getGlobalCentrality(limit || 10)
			return hubs.map((h: any) => `[Hub: ${h.kbId}] Score: ${h.score}\nContent: ${h.content}`).join("\n---\n")
		} catch (error) {
			return `Failed to fetch top hubs: ${error}`
		}
	}
}
