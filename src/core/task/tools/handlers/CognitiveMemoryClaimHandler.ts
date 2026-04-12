import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { SwarmMutexService } from "../../../swarm/SwarmMutexService"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryClaimHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_CLAIM

	getDescription(_block: ToolUse): string {
		return "Claim exclusive access to a resource (file or concept) to prevent swarm conflicts."
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { resource, timeoutMs } = block.params as { resource: string; timeoutMs?: number }
		if (!resource) {
			return `Resource name is required for claim.`
		}

		try {
			// Use taskId as owner for now since we don't have a specific agentId in basic TaskConfig
			await SwarmMutexService.claim(resource, config.taskId, timeoutMs)
			return `Resource '${resource}' successfully claimed.`
		} catch (error) {
			return `Failed to claim resource '${resource}': ${error}`
		}
	}
}
