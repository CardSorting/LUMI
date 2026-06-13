import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@shared/tools"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import type { TaskConfig } from "../types/TaskConfig"
import type { IToolHandler, ToolResponse } from "../types/ToolContracts"

export class RoadmapToolHandler implements IToolHandler {
	readonly name: DietCodeDefaultTool

	constructor(name: DietCodeDefaultTool = DietCodeDefaultTool.ROADMAP) {
		this.name = name
	}

	getDescription(block: ToolUse): string {
		return `[${block.name} action='${block.params.action || "default"}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const workspace = config.cwd
		interface RoadmapParams {
			action?: string
			context?: string
			user_request?: string
		}
		const params = block.params as RoadmapParams
		const actionParam = (params.action || "").trim().toLowerCase()

		let action = actionParam
		if (!action) {
			if (block.name === DietCodeDefaultTool.ROADMAP_CHECKPOINT) {
				action = "checkpoint"
			} else {
				action = "guide"
			}
		}

		const roadmapService = RoadmapService.getInstance()
		let result: unknown

		switch (action) {
			case "guide":
			case "status":
			case "cockpit":
				result = await roadmapService.getOperationalStatus(workspace, params.context)
				break
			case "checkpoint":
				result = await roadmapService.checkpointBrief(workspace, params.context, params.user_request)
				break
			case "validate":
			case "doctor":
				result = await roadmapService.validateRoadmap(workspace)
				break
			case "apply_bootstrap_fill":
				result = await roadmapService.applyBootstrapFillBrief(workspace, params.context)
				break
			case "template":
				result = await roadmapService.getTemplateBrief(workspace)
				break
			default:
				result = await roadmapService.getOperationalStatus(workspace, params.context)
				break
		}

		return JSON.stringify(result, null, 2)
	}
}
