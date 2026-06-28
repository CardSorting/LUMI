import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import { cacheGateLifecycleDecision, evaluateGateLifecycle } from "./completion/GateLifecycleEvaluator"
import { runSubagentCompletionLanePreflight } from "./completionGatePipeline"
import type { TaskConfig } from "./types/TaskConfig"

export type SubagentCompletionGateValidation = {
	error: string | null
	lifecycle: GateLifecycleDecision
	/** Hardening audit deferred to parent seal barrier — never blocks lane throughput. */
	auditDeferredToSeal: boolean
}

/**
 * Lane completion gates — zen fast path for throughput (ADR-013).
 * Sync quality/safety preflight only; expensive auditTask runs at seal barrier.
 * Parent attempt_completion retains full blocking enforcement.
 */
export async function validateSubagentCompletionGates(
	config: TaskConfig,
	result: string,
	_taskProgress?: string,
	command?: string,
	options?: { laneExecutionMode?: LaneExecutionMode },
): Promise<SubagentCompletionGateValidation> {
	const subagentConfig = config.isSubagentExecution ? config : { ...config, isSubagentExecution: true }

	const preflightError = runSubagentCompletionLanePreflight(subagentConfig, {
		result,
		command,
		laneExecutionMode: options?.laneExecutionMode,
	})
	if (preflightError) {
		const lifecycle = evaluateGateLifecycle(subagentConfig)
		cacheGateLifecycleDecision(subagentConfig, lifecycle)
		return { error: preflightError, lifecycle, auditDeferredToSeal: false }
	}

	const lifecycle = evaluateGateLifecycle(subagentConfig)
	cacheGateLifecycleDecision(subagentConfig, lifecycle)

	return {
		error: null,
		lifecycle,
		auditDeferredToSeal: true,
	}
}
