import { runCompletionGateFlow } from "./completionGatePipeline"
import type { TaskConfig } from "./types/TaskConfig"

export async function validateSubagentCompletionGates(
	config: TaskConfig,
	result: string,
	taskProgress?: string,
	command?: string,
): Promise<string | null> {
	const flow = await runCompletionGateFlow(config, { result, taskProgress, command, taskDescription: result }, "SubagentRunner")

	if (flow.status === "blocked") {
		return flow.message
	}

	return null
}
