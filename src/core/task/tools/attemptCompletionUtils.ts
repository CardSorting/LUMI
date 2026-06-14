import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { DietCodeDefaultTool } from "@shared/tools"
import type { TaskConfig } from "./types/TaskConfig"
import type { ToolResponse } from "./types/ToolContracts"

export function canonicalizeAttemptCompletionParams(block: ToolUse): boolean {
	if (block.name === DietCodeDefaultTool.ATTEMPT && !block.params?.result && typeof block.params?.response === "string") {
		block.params.result = block.params.response
		return true
	}

	return false
}

export function canonicalizeAttemptCompletionResultParams(params: Record<string, unknown> | undefined): boolean {
	if (!params?.result && typeof params?.response === "string") {
		params.result = params.response
		return true
	}

	return false
}

export function shouldRejectDoubleCheckCompletion(doubleCheckEnabled: boolean, doubleCheckCompletionPending: boolean): boolean {
	return doubleCheckEnabled && !doubleCheckCompletionPending
}

function getCompletionGateCircuitBreakerMessage(config: TaskConfig): string | null {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	if (blockCount >= MAX_COMPLETION_GATE_BLOCK_COUNT) {
		config.taskState.consecutiveMistakeCount++
		return (
			`Task completion blocked: maximum completion gate retries (${MAX_COMPLETION_GATE_BLOCK_COUNT}) exceeded. ` +
			"Review audit violations, address root causes, and start a new task if the gate cannot be satisfied."
		)
	}

	return null
}

export function getCompletionGateCircuitBreakerError(config: TaskConfig): string | null {
	return getCompletionGateCircuitBreakerMessage(config)
}

export function checkCompletionGateCircuitBreaker(config: TaskConfig): ToolResponse | null {
	const message = getCompletionGateCircuitBreakerMessage(config)
	return message ? formatResponse.toolError(message) : null
}

export function markCompletionGatesPassed(config: TaskConfig): void {
	config.taskState.consecutiveMistakeCount = 0
}

export function markCompletionAttemptFinished(config: TaskConfig): void {
	config.taskState.doubleCheckCompletionPending = false
}
