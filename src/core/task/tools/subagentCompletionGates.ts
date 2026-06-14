import { resolveCompletionGateContext } from "@shared/audit/auditGatePolicyLoader"
import { evaluateCompletionGate } from "@shared/audit/auditGateReport"
import { buildCompletionGateMessage, runCompletionAudit } from "@shared/audit/completionAudit"
import { parseIntentThresholdOverrides } from "@shared/audit/gatePolicy"
import { Logger } from "@shared/services/Logger"
import { evaluateRoadmapCompletionBlock, failClosedCompletionMessage } from "@/services/roadmap/RoadmapCompletionGate"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { getCompletionGateCircuitBreakerError, markCompletionGatesPassed } from "./attemptCompletionUtils"
import type { TaskConfig } from "./types/TaskConfig"

export async function validateSubagentCompletionGates(config: TaskConfig, result: string): Promise<string | null> {
	const circuitBreakerMessage = getCompletionGateCircuitBreakerError(config)
	if (circuitBreakerMessage) {
		return circuitBreakerMessage
	}

	const roadmapService = RoadmapService.getInstance()
	if (roadmapService.isEnabled()) {
		try {
			const block = await evaluateRoadmapCompletionBlock(config.cwd)
			if (block.blocked) {
				config.taskState.consecutiveMistakeCount++
				return block.message || failClosedCompletionMessage()
			}
		} catch (error) {
			Logger.error("[SubagentRunner] Failed to evaluate Roadmap Governance Gates:", error)
			if (roadmapService.getConfig().fail_closed_completion_gates) {
				config.taskState.consecutiveMistakeCount++
				return failClosedCompletionMessage()
			}
		}
	}

	if (!config.auditCompletionGateEnabled) {
		return null
	}

	try {
		const auditMetadata = await runCompletionAudit(config.taskId, result, result, result)
		const gateContext = await resolveCompletionGateContext(config, config.cwd, {
			lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
		})
		const gateDecision = evaluateCompletionGate(auditMetadata, gateContext.options)
		if (gateDecision.blocked) {
			config.taskState.consecutiveMistakeCount++
			config.taskState.completionGateBlockCount = (config.taskState.completionGateBlockCount ?? 0) + 1
			return buildCompletionGateMessage(auditMetadata, {
				scoreThreshold: config.auditCompletionGateThreshold,
				criticalOnly: config.auditCompletionGateCriticalOnly,
				intentAdjustedThreshold: config.auditIntentThresholdAdjustmentsEnabled,
				intentThresholdOverrides: parseIntentThresholdOverrides(config.auditIntentThresholdOverrides),
				advisoryMetadata: config.taskState.lastAdvisoryAudit,
				gateDecision,
			})
		}
		markCompletionGatesPassed(config)
	} catch (error) {
		Logger.error("[SubagentRunner] Failed to run completion audit gate:", error)
		config.taskState.consecutiveMistakeCount++
		return (
			"Task completion blocked: hardening audit evaluation failed. " +
			"Fix the underlying issue or retry after audit services recover."
		)
	}

	return null
}
