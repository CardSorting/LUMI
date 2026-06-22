import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import { evaluateGateLifecycle, publishGateLifecycleStatus } from "./completion/GateLifecycleEvaluator"
import { runCompletionGateFlow } from "./completionGatePipeline"
import type { TaskConfig } from "./types/TaskConfig"

export async function validateSubagentCompletionGates(
	config: TaskConfig,
	result: string,
	taskProgress?: string,
	command?: string,
): Promise<{ error: string | null; lifecycle: GateLifecycleDecision }> {
	const flow = await runCompletionGateFlow(config, { result, taskProgress, command, taskDescription: result }, "SubagentRunner")

	const lifecycle = evaluateGateLifecycle(config)
	await publishGateLifecycleStatus(config, lifecycle)

	if (flow.status === "blocked") {
		return { error: flow.message, lifecycle }
	}

	return { error: null, lifecycle }
}
