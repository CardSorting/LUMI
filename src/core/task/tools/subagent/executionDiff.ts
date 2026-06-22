import type { DietCodeSaySubagentStatus } from "@shared/ExtensionMessage"
import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import { diffSubagentStatuses, type ExecutionDiffReport } from "@shared/execution/statusDiff"
import type { SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"

export type { ExecutionAgentDiff, ExecutionDiffChangeKind, ExecutionDiffReport } from "@shared/execution/statusDiff"
export { diffSubagentStatuses } from "@shared/execution/statusDiff"

function statusFromEnvelope(envelope: SwarmExecutionEnvelope): DietCodeSaySubagentStatus {
	return {
		status: envelope.status === "interrupted" ? "failed" : envelope.status,
		total: envelope.agents.length,
		completed: envelope.agents.filter((agent) => agent.status === "completed" || agent.status === "failed").length,
		successes: envelope.agents.filter((agent) => agent.status === "completed").length,
		failures: envelope.agents.filter((agent) => agent.status === "failed").length,
		toolCalls: envelope.agents.reduce((acc, agent) => acc + agent.toolSteps.length, 0),
		inputTokens: 0,
		outputTokens: 0,
		contextWindow: 0,
		maxContextTokens: 0,
		maxContextUsagePercentage: 0,
		items: envelope.agents.map((agent) => ({
			id: agent.agentId,
			name: agent.role,
			index: agent.lineage.index,
			prompt: agent.prompt,
			status: agent.status,
			toolCalls: agent.toolSteps.length,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
			result: agent.verbatimOutput,
			error: agent.error,
			blockers: agent.blockers,
			warnings: agent.warnings,
			touchedFiles: agent.touchedFiles,
			evidenceCount: agent.evidenceRefs.length,
			transcriptEventCount: agent.transcriptEventCount,
			compactionEventCount: agent.compactionEvents.length,
		})),
		swarmId: envelope.swarmId,
		invariantViolations: envelope.invariants.violations,
	}
}

export function diffSwarmEnvelopes(left: SwarmExecutionEnvelope, right: SwarmExecutionEnvelope): ExecutionDiffReport {
	return diffSubagentStatuses(statusFromEnvelope(left), statusFromEnvelope(right))
}

export function diffReplayArtifacts(
	left: ExecutionReplayArtifact,
	right: ExecutionReplayArtifact,
	leftEnvelope?: SwarmExecutionEnvelope,
	rightEnvelope?: SwarmExecutionEnvelope,
): ExecutionDiffReport {
	if (leftEnvelope && rightEnvelope) {
		return diffSwarmEnvelopes(leftEnvelope, rightEnvelope)
	}
	throw new Error("Replay artifact diff requires source swarm envelopes")
}
