import { EXECUTION_FUNNEL_SCHEMA_VERSION, type ExecutionFunnelEvent } from "@shared/execution/executionFunnelEvent"

let invocationSequence = 0

/** Modern terminal execution evidence for envelope fixtures. */
export function terminalExecutionEvent(toolName = "read_file", taskId = "task-1"): ExecutionFunnelEvent {
	const completedAt = Date.now()
	return {
		schemaVersion: EXECUTION_FUNNEL_SCHEMA_VERSION,
		taskId,
		invocationId: `fixture:${toolName}:${++invocationSequence}`,
		permitId: `fixture-permit:${invocationSequence}`,
		toolName,
		lane: "subagent",
		phase: "succeeded",
		kind: "success",
		reasonCode: "operation_succeeded",
		terminal: true,
		reason: "Fixture operation completed successfully.",
		stages: [
			{
				stage: "dispatch",
				result: "passed",
				reason: "Fixture handler returned one result",
				decisive: false,
			},
		],
		workspaceRevision: 0,
		evaluatedAt: completedAt,
		completedAt,
	}
}
