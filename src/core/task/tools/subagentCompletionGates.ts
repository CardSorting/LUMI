import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import {
	cacheCompletionFunnelEvent,
	decisionToCompletionFunnelEvent,
	evaluateCompletionFunnel,
} from "./completion/CompletionFunnel"
import { runSubagentCompletionLanePreflight } from "./completionGatePipeline"
import type { TaskConfig } from "./types/TaskConfig"

export type SubagentCompletionGateValidation = {
	error: string | null
	diagnostics: string[]
	completionFunnelEvent: CompletionFunnelEvent
	/** Hardening audit deferred to parent seal barrier — never blocks lane throughput. */
	auditDeferredToSeal: boolean
}

/**
 * Lane completion diagnostics — advisory fast path for throughput.
 * Sync quality/safety findings are evidence only; expensive auditTask runs at
 * the seal barrier and is also advisory.
 */
export async function validateSubagentCompletionGates(
	config: TaskConfig,
	result: string,
	_taskProgress?: string,
	command?: string,
	options?: { laneExecutionMode?: LaneExecutionMode },
): Promise<SubagentCompletionGateValidation> {
	const subagentConfig = config.isSubagentExecution ? config : { ...config, isSubagentExecution: true }

	const diagnostics = runSubagentCompletionLanePreflight(subagentConfig, {
		result,
		command,
		laneExecutionMode: options?.laneExecutionMode,
	})
	const completionFunnelEvent = decisionToCompletionFunnelEvent(
		subagentConfig,
		evaluateCompletionFunnel(subagentConfig, { result }),
	)
	cacheCompletionFunnelEvent(subagentConfig, completionFunnelEvent)

	return {
		error: null,
		diagnostics,
		completionFunnelEvent,
		auditDeferredToSeal: true,
	}
}
