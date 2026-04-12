import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryChokeHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_CHOKE

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const limit = block.params.limit ? Number.parseInt(block.params.limit, 10) : 10

		try {
			const chokepoints = await config.services.knowledgeGraphService.detectChokepoints(config.taskId, limit)

			if (chokepoints.length === 0) {
				return formatResponse.toolResult("No architectural chokepoints detected in history.")
			}

			const formatted = chokepoints.map((c) => `- ${c.path} (score/churn: ${c.score})`).join("\n")

			return formatResponse.toolResult(
				`Architectural Chokepoint Detection (Top ${limit}):\n\n${formatted}\n\nThese files have high churn and are potential bottlenecks.`,
			)
		} catch (error) {
			return `Error detecting chokepoints: ${(error as Error)?.message}`
		}
	}
}
