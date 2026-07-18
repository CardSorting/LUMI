import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope, SwarmInvariantReport } from "@shared/subagent/executionEnvelope"
import { SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import type { GovernedExecutionPathMetrics } from "@shared/subagent/governedExecution"

export interface SwarmValidationSnapshot {
	/** Checksum excludes mutable invariant presentation fields. */
	executionChecksum: string
	report: SwarmInvariantReport
}

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
		if (envelope.executionValidity === "invalid") {
			violations.push(`agent ${envelope.agentId}: completed with invalid execution validity`)
		}
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
	if (envelope.status === "failed" && envelope.executionValidity === "valid") {
		violations.push(`agent ${envelope.agentId}: failed with valid execution validity`)
	}

	for (const compaction of envelope.compactionEvents || []) {
		if (compaction.contentKind !== "summary") {
			violations.push(`agent ${envelope.agentId}: compaction event must be marked summary`)
		}
		if (compaction.transcriptSequence < 0) {
			violations.push(`agent ${envelope.agentId}: compaction missing transcript sequence anchor`)
		}
	}
	for (const step of envelope.toolSteps || []) {
		if (!step.executionFunnelEvent?.terminal) {
			violations.push(`agent ${envelope.agentId}: tool step ${step.index} lacks a terminal ExecutionFunnel event`)
		}
	}

	if (envelope.phase === "completion_gate" && !envelope.completionFunnelEvent) {
		violations.push(`agent ${envelope.agentId}: completion_gate phase without completionFunnelEvent snapshot`)
	}

	return violations
}

export function auditSubagentEnvelopeQuality(envelope: SubagentExecutionEnvelope): string[] {
	const warnings: string[] = []
	if ((envelope.status === "completed" || envelope.status === "failed") && !envelope.transcriptArtifactPath?.trim()) {
		warnings.push(`agent ${envelope.agentId}: missing transcript artifact path`)
	}
	if (envelope.status === "completed" && envelope.verbatimOutput?.trim() && envelope.evidenceRefs.length === 0) {
		warnings.push(`agent ${envelope.agentId}: missing evidence references`)
	}
	if (!envelope.executionValidity) {
		warnings.push(`agent ${envelope.agentId}: historical envelope missing execution validity`)
	}
	return warnings
}

export function validateSwarmEnvelope(envelope: SwarmExecutionEnvelope): SwarmInvariantReport {
	const violations: string[] = []
	const advisoryWarnings: string[] = []

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
		advisoryWarnings.push(...auditSubagentEnvelopeQuality(agent))
	}

	if (envelope.summaryOverlay !== undefined && envelope.summaryOverlay.trim().length === 0) {
		violations.push("malformed summary: summary overlay is empty")
	}

	return {
		validated: violations.length === 0,
		violations,
		advisoryWarnings: [...new Set(advisoryWarnings)],
	}
}

export function createSwarmValidationSnapshot(
	envelope: SwarmExecutionEnvelope,
	executionChecksum: string,
	metrics?: GovernedExecutionPathMetrics,
): SwarmValidationSnapshot {
	if (metrics) {
		metrics.envelopeValidationCalls++
	}
	return {
		executionChecksum,
		report: validateSwarmEnvelope(envelope),
	}
}

export function reuseSwarmValidationSnapshot(
	snapshot: SwarmValidationSnapshot | undefined,
	executionChecksum: string,
	metrics?: GovernedExecutionPathMetrics,
): SwarmInvariantReport | undefined {
	if (!snapshot || snapshot.executionChecksum !== executionChecksum) {
		return undefined
	}
	if (metrics) {
		metrics.envelopeValidationReuses++
	}
	return snapshot.report
}

export function assertSwarmEnvelopeOrThrow(envelope: SwarmExecutionEnvelope): void {
	const report = validateSwarmEnvelope(envelope)
	if (!report.validated) {
		throw new Error(`Swarm envelope invariant violation: ${report.violations.join("; ")}`)
	}
}
