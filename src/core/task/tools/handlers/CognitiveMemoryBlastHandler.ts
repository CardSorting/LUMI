import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryBlastHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_BLAST

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const path = block.params.path
		const maxDepth = block.params.maxDepth ? Number.parseInt(block.params.maxDepth, 10) : 2

		if (!path) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		try {
			const radius = await config.services.knowledgeGraphService.calculateBlastRadius(config.taskId, path, maxDepth)

			if (radius.length === 0) {
				return formatResponse.toolResult(`No impact detected for '${path}' at depth ${maxDepth}.`)
			}

			const formatted = radius.map((r) => `- ${r.path} (depth: ${r.depth})`).join("\n")

			return formatResponse.toolResult(
				`Blast Radius Analysis for '${path}' (max depth: ${maxDepth}):\n\n${formatted}\n\nThese files may be semantically affected by changes to '${path}'.`,
			)
		} catch (error) {
			return `Error calculating blast radius: ${(error as Error)?.message}`
		}
	}
}
