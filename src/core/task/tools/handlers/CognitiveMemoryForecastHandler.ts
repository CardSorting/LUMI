import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryForecastHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_FORECAST

	getDescription(block: ToolUse): string {
		return `[Forecast merge risk for '${block.params.sourceStreamId}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const { sourceStreamId, targetStreamId } = block.params as { sourceStreamId: string; targetStreamId?: string }

		if (!sourceStreamId) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "sourceStreamId")
		}

		const targetId = targetStreamId || config.taskId // Default to current task

		try {
			const forecast = await config.services.knowledgeGraphService.simulateMergeForecast(sourceStreamId, targetId)

			let report = `Merge Forecast for ${sourceStreamId} -> ${targetId}:\n\n`
			report += `Risk Level: ${forecast.isHighRisk ? "🔴 HIGH" : "🟢 LOW"}\n`
			report += `Direct Conflicts: ${forecast.conflicts.length}\n`

			if (forecast.conflicts.length > 0) {
				report += `Files: ${forecast.conflicts.join(", ")}\n`
			}

			if (forecast.semanticOverlaps.length > 0) {
				report += `\nSemantic Overlaps detected:\n`
				for (const overlap of forecast.semanticOverlaps) {
					report += `- ${overlap.path}: ${overlap.reason}\n`
				}
			}

			return formatResponse.toolResult(report)
		} catch (error) {
			return `Error during merge forecast: ${(error as Error)?.message}`
		}
	}
}
