import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@shared/tools"
import { NativeMutationManager } from "@/services/mutation/NativeMutationManager"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class DietcodeKernelToolHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.DIETCODE_KERNEL

	getDescription(block: ToolUse): string {
		return `[${block.name} action='${block.params.action || "default"}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as any
		const workspace = params.workspace || config.cwd
		const action = (params.action || "").trim().toLowerCase()
		const taskId = params.task_id || config.ulid

		const mutationManager = NativeMutationManager.getInstance()
		let result: any

		switch (action) {
			case "status":
				result = await mutationManager.getStatus(workspace)
				break
			case "search": {
				const query = params.query || ""
				const maxResults = params.max_results !== undefined ? Number(params.max_results) : 20
				result = await mutationManager.searchLiteral(workspace, query, maxResults)
				break
			}
			case "patch": {
				const filePath = params.path || ""
				const unifiedDiff = params.unified_diff || ""
				const lineSearch = params.line_search || ""
				const lineReplace = params.line_replace || ""
				result = await mutationManager.applyPatch(workspace, filePath, unifiedDiff, lineSearch, lineReplace, taskId)
				break
			}
			case "verify": {
				const command = params.command || ""
				const cwd = params.cwd || ""
				result = await mutationManager.applyVerify(workspace, command, cwd, taskId)
				break
			}
			default:
				result = {
					ok: false,
					error: {
						string_code: "unknown_action",
						message: `Unknown kernel bridge action: ${action}`,
					},
				}
				break
		}

		return JSON.stringify(result, null, 2)
	}
}
