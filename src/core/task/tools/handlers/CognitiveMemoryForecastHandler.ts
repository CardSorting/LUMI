import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import type { IToolHandler, ToolResponse } from "../types/ToolContracts"

export class CognitiveMemoryForecastHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.MEM_FORECAST

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
