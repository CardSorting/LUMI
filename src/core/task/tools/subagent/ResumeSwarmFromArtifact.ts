import { createHash } from "node:crypto"
import type { SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { SWARM_ARTIFACT_MAX_AGE_MS, SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import { validateSwarmEnvelope } from "./executionValidation"
import { loadSwarmEnvelope } from "./SubagentExecutionStore"
import { loadTranscriptEvents } from "./SubagentTranscriptRecorder"

export interface SwarmArtifactIntegrityReport {
	valid: boolean
	violations: string[]
	checksum: string
}

export const SWARM_TERMINAL_STAGING_VIOLATION = "terminal receipt not sealed"

export interface SwarmResumeAgentReuse {
	agentId: string
	index: number
	prompt: string
	result: string
	envelopeId: string
}

export interface SwarmResumeAgentRetry {
	agentId: string
	index: number
	prompt: string
	previousError?: string
	retryHints: string[]
}

export interface SwarmResumeAgentRestart {
	agentId: string
	index: number
	prompt: string
}

export interface SwarmRecoveryReceipt {
	resumeAttemptId: string
	parentExecutionId: string
	sourceSwarmId: string
	reusedAgentCount: number
	retriedAgentCount: number
	restartedAgentCount: number
	recoveredAt: number
	operatorVisible: true
}

export interface SwarmResumePlan {
	resumeAttemptId: string
	parentExecutionId: string
	sourceSwarmId: string
	taskId: string
	newSwarmId: string
	reuseAgents: SwarmResumeAgentReuse[]
	retryAgents: SwarmResumeAgentRetry[]
	restartAgents: SwarmResumeAgentRestart[]
	recoveryReceipt: SwarmRecoveryReceipt
	rejectedReason?: string
}

export function computeSwarmArtifactChecksum(envelope: SwarmExecutionEnvelope): string {
	const { checksum: _ignored, invariants: _invariants, ...payload } = envelope
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)
}

export async function validateArtifactIntegrity(
	taskId: string,
	envelope: SwarmExecutionEnvelope,
): Promise<SwarmArtifactIntegrityReport> {
	const violations: string[] = []

	if (envelope.schemaVersion !== SWARM_ENVELOPE_SCHEMA_VERSION) {
		violations.push(`unsupported schema version: ${envelope.schemaVersion}`)
	}
	if (envelope.taskId !== taskId) {
		violations.push("artifact task id mismatch")
	}

	const invariantReport = validateSwarmEnvelope(envelope)
	violations.push(...invariantReport.violations)
	if (envelope.invariants.violations.includes(SWARM_TERMINAL_STAGING_VIOLATION)) {
		violations.push(SWARM_TERMINAL_STAGING_VIOLATION)
	}

	for (const agent of envelope.agents) {
		if (!agent.transcriptArtifactPath) {
			if (agent.status === "completed" || agent.status === "failed") {
				violations.push(`agent ${agent.agentId}: missing transcript artifact path`)
			}
			continue
		}

		const transcript = await loadTranscriptEvents(taskId, envelope.swarmId, agent.agentId)
		if (transcript.corruption) {
			violations.push(`agent ${agent.agentId}: corrupted transcript (${transcript.corruption})`)
		}

		const compactionWithoutTranscript = agent.compactionEvents.some(
			(event) => event.transcriptSequence < 0 || event.transcriptSequence > transcript.events.length - 1,
		)
		if (compactionWithoutTranscript && agent.compactionEvents.length > 0 && transcript.events.length === 0) {
			violations.push(`agent ${agent.agentId}: compaction recorded without transcript evidence`)
		}
	}

	const checksum = computeSwarmArtifactChecksum(envelope)
	if (envelope.checksum && envelope.checksum !== checksum) {
		violations.push("artifact checksum mismatch")
	}

	return {
		valid: violations.length === 0,
		violations,
		checksum,
	}
}

export function isArtifactStale(envelope: SwarmExecutionEnvelope, maxAgeMs = SWARM_ARTIFACT_MAX_AGE_MS): boolean {
	const reference = envelope.timestamps.completed || envelope.continuity.lastPersistedAt
	return Date.now() - reference > maxAgeMs
}

export async function planResumeFromArtifact(
	taskId: string,
	sourceSwarmId: string,
	options?: { maxAgeMs?: number; newSwarmId?: string },
): Promise<SwarmResumePlan> {
	const envelope = await loadSwarmEnvelope(taskId, sourceSwarmId)
	if (!envelope) {
		throw new Error(`Swarm execution artifact not found: ${sourceSwarmId}`)
	}

	const integrity = await validateArtifactIntegrity(taskId, envelope)
	if (!integrity.valid) {
		throw new Error(`Artifact integrity validation failed: ${integrity.violations.join("; ")}`)
	}

	if (isArtifactStale(envelope, options?.maxAgeMs)) {
		throw new Error(`Artifact is stale and cannot be resumed: ${sourceSwarmId}`)
	}

	if (envelope.status === "completed") {
		throw new Error(`Artifact already completed and cannot be resumed: ${sourceSwarmId}`)
	}

	const resumeAttemptId = `resume_${Date.now()}`
	const newSwarmId = options?.newSwarmId || `swarm_${resumeAttemptId}`
	const reuseAgents: SwarmResumeAgentReuse[] = []
	const retryAgents: SwarmResumeAgentRetry[] = []
	const restartAgents: SwarmResumeAgentRestart[] = []

	for (const agent of envelope.agents) {
		const base = {
			agentId: agent.agentId,
			index: agent.lineage.index,
			prompt: agent.prompt,
		}

		if (agent.status === "completed" && agent.verbatimOutput?.trim()) {
			reuseAgents.push({
				...base,
				result: agent.verbatimOutput,
				envelopeId: agent.agentId,
			})
			continue
		}

		if (agent.status === "failed") {
			retryAgents.push({
				...base,
				previousError: agent.error,
				retryHints: agent.retryHints,
			})
			continue
		}

		restartAgents.push(base)
	}

	const recoveryReceipt: SwarmRecoveryReceipt = {
		resumeAttemptId,
		parentExecutionId: envelope.executionId,
		sourceSwarmId,
		reusedAgentCount: reuseAgents.length,
		retriedAgentCount: retryAgents.length,
		restartedAgentCount: restartAgents.length,
		recoveredAt: Date.now(),
		operatorVisible: true,
	}

	return {
		resumeAttemptId,
		parentExecutionId: envelope.executionId,
		sourceSwarmId,
		taskId,
		newSwarmId,
		reuseAgents,
		retryAgents,
		restartAgents,
		recoveryReceipt,
	}
}
