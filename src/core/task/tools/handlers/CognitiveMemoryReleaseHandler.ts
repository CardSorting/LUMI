import { CodemarieDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { SwarmMutexService } from "../../../swarm/SwarmMutexService"
import { IToolHandler } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export class CognitiveMemoryReleaseHandler implements IToolHandler {
	readonly name = CodemarieDefaultTool.MEM_RELEASE

	getDescription(_block: ToolUse): string {
		return "Release a previously claimed resource."
	}

	async execute(_config: TaskConfig, block: ToolUse): Promise<any> {
		const { resource } = block.params as { resource: string }
		if (!resource) {
			return `Resource name is required for release.`
		}

		await SwarmMutexService.release(resource, _config.taskId)
		return `Resource '${resource}' has been released.`
	}
}
