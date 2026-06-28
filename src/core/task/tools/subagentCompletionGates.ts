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
	// This entry point is exclusively used by SubagentRunner. The parent config is intentionally
	// inherited for policy/audit context, but parent-only focus-chain requirements must not block a lane.
	const subagentConfig = config.isSubagentExecution ? config : { ...config, isSubagentExecution: true }
	const flow = await runCompletionGateFlow(
		subagentConfig,
		{ result, taskProgress, command, taskDescription: result },
		"SubagentRunner",
	)

	const lifecycle = evaluateGateLifecycle(subagentConfig)
	await publishGateLifecycleStatus(subagentConfig, lifecycle)

	if (flow.status === "blocked") {
		return { error: flow.message, lifecycle }
	}

	return { error: null, lifecycle }
}
