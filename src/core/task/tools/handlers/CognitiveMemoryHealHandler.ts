import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryHealHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_HEAL

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const path = block.params.path

		if (!path) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		try {
			const recovery = await config.services.knowledgeGraphService.recoverFile(config.taskId, path)

			if (!recovery) {
				return formatResponse.toolResult(`No historical state found for '${path}'.`)
			}

			return formatResponse.toolResult(
				`Historical state recovered for '${path}' from snapshot ${recovery.sourceId}:\n\n` +
					`\`\`\`\n${recovery.content}\n\`\`\`\n\n` +
					`You can use 'write_to_file' to restore this content if needed.`,
			)
		} catch (error) {
			return `Error recovering file state: ${(error as Error)?.message}`
		}
	}
}
