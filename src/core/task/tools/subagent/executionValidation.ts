import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope, SwarmInvariantReport } from "@shared/subagent/executionEnvelope"
import { SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"

export function validateSubagentEnvelope(envelope: SubagentExecutionEnvelope): string[] {
	const violations: string[] = []

	if (!envelope.agentId?.trim()) {
		violations.push("missing agent id")
	}
	if (!envelope.parentSwarmId?.trim()) {
		violations.push("missing parent swarm id")
	}
	if (!envelope.prompt?.trim()) {
		violations.push("missing prompt")
	}

	if (envelope.status === "completed") {
		if (!envelope.verbatimOutput?.trim()) {
			violations.push(`agent ${envelope.agentId}: completed without verbatim output`)
		}
		if (envelope.blockers.length > 0) {
			violations.push(`agent ${envelope.agentId}: completed with unresolved blockers`)
		}
	}

	if (envelope.status === "failed" && !envelope.error?.trim()) {
		violations.push(`agent ${envelope.agentId}: failed without error message`)
	}

	if ((envelope.status === "completed" || envelope.status === "failed") && !envelope.transcriptArtifactPath?.trim()) {
		violations.push(`agent ${envelope.agentId}: missing transcript artifact path`)
	}

	for (const compaction of envelope.compactionEvents || []) {
		if (compaction.contentKind !== "summary") {
			violations.push(`agent ${envelope.agentId}: compaction event must be marked summary`)
		}
		if (compaction.transcriptSequence < 0) {
			violations.push(`agent ${envelope.agentId}: compaction missing transcript sequence anchor`)
		}
	}

	if (envelope.phase === "completion_gate" && !envelope.gateLifecycleStatus) {
		violations.push(`agent ${envelope.agentId}: completion_gate phase without gateLifecycleStatus snapshot`)
	}

	return violations
}

export function validateSwarmEnvelope(envelope: SwarmExecutionEnvelope): SwarmInvariantReport {
	const violations: string[] = []

	if (!envelope.swarmId?.trim()) {
		violations.push("missing swarm id")
	}
	if (!envelope.taskId?.trim()) {
		violations.push("missing task id")
	}
	if (!Array.isArray(envelope.agents) || envelope.agents.length === 0) {
		violations.push("swarm has no agents")
	}

	if (envelope.schemaVersion !== SWARM_ENVELOPE_SCHEMA_VERSION) {
		violations.push(`unsupported swarm schema version: ${envelope.schemaVersion}`)
	}

	const terminalStatuses = new Set(["completed", "failed"])
	const pendingAgents = envelope.agents.filter((agent) => !terminalStatuses.has(agent.status))
	const resumableStatuses = new Set<SwarmExecutionEnvelope["status"]>(["running", "interrupted"])
	if (!resumableStatuses.has(envelope.status) && pendingAgents.length > 0) {
		violations.push(`orphaned subtasks: ${pendingAgents.map((agent) => agent.agentId).join(", ")}`)
	}

	const successes = envelope.agents.filter((agent) => agent.status === "completed")
	if (envelope.status === "completed" && successes.length === 0 && envelope.agents.length > 0) {
		violations.push("empty success report: swarm completed with zero successful agents")
	}

	for (const agent of envelope.agents) {
		violations.push(...validateSubagentEnvelope({ ...agent, compactionEvents: agent.compactionEvents || [] }))
	}

	if (envelope.summaryOverlay !== undefined && envelope.summaryOverlay.trim().length === 0) {
		violations.push("malformed summary: summary overlay is empty")
	}

	const completedWithEvidence = envelope.agents.filter((agent) => agent.status === "completed" && agent.verbatimOutput?.trim())
	if (completedWithEvidence.length > 0) {
		const missingEvidence = completedWithEvidence.filter((agent) => agent.evidenceRefs.length === 0)
		if (missingEvidence.length === completedWithEvidence.length) {
			violations.push("missing evidence: no agent preserved evidence references")
		}
	}

	return {
		validated: violations.length === 0,
		violations,
	}
}

export function assertSwarmEnvelopeOrThrow(envelope: SwarmExecutionEnvelope): void {
	const report = validateSwarmEnvelope(envelope)
	if (!report.validated) {
		throw new Error(`Swarm envelope invariant violation: ${report.violations.join("; ")}`)
	}
}
