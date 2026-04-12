import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryQueryHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_QUERY

	getDescription(_block: ToolUse): string {
		return "[query cognitive memory]"
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { text, augmentWithGraph, maxDepth, limit } = block.params as {
			text: string
			augmentWithGraph?: boolean
			maxDepth?: number
			limit?: number
		}
		if (!text) {
			return config.callbacks.sayAndCreateMissingParamError(this.name, "text", "")
		}

		const kgService = config.services.knowledgeGraphService
		if (!kgService) {
			return formatResponse.toolError("Knowledge Graph service is not available.")
		}

		try {
			const snapshots = await kgService.searchKnowledge(config.taskId, text, {
				augmentWithGraph: augmentWithGraph ?? true,
				maxDepth: maxDepth ?? 1,
				limit: limit ?? 5,
			})
			if (snapshots.length === 0) {
				return "No relevant cognitive knowledge found."
			}

			const formattedSnapshots = snapshots
				.map((s, i) => {
					const similarity = s.similarity !== undefined ? ` [Similarity: ${(s.similarity * 100).toFixed(1)}%]` : ""
					const neighbors = (s as any).neighbors ? ` [Neighbors: ${(s as any).neighbors.length}]` : ""
					return `${i + 1}. [ID: ${s.id}]${similarity}${neighbors}\n${s.content}`
				})
				.join("\n\n---\n\n")

			return `Found ${snapshots.length} relevant cognitive knowledge nodes:\n\n${formattedSnapshots}`
		} catch (error) {
			return formatResponse.toolError(`Failed to query cognitive memory: ${error}`)
		}
	}
}
