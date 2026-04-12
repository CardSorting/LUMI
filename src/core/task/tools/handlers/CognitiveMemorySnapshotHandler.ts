import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemorySnapshotHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_SNAPSHOT

	getDescription(_block: ToolUse): string {
		return "[create cognitive snapshot]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { content, metadata } = block.params as { content: string; metadata?: string }
		if (!content) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "content")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			let _parsedMetadata = {}
			if (metadata) {
				try {
					_parsedMetadata = JSON.parse(metadata)
				} catch (_e) {
					_parsedMetadata = { raw: metadata }
				}
			}

			const snapshotId = await kgService.cognitiveSnapshot(config.taskId, content, 0) // Count 0 for manual

			return `Successfully created cognitive graph node with ID: ${snapshotId}`
		} catch (error) {
			return formatResponse.toolError(`Failed to create cognitive snapshot: ${error}`)
		}
	}
}
