import type {
	ExecutionReplayArtifact,
	ExecutionReplayIntegrityReport,
	ExecutionReplaySource,
} from "@shared/execution/replayContract"
import type { SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { computeSwarmArtifactChecksum } from "./ResumeSwarmFromArtifact"

export function swarmEnvelopeToReplayArtifact(envelope: SwarmExecutionEnvelope): ExecutionReplayArtifact {
	const source: ExecutionReplaySource = "swarm"
	const integrity: ExecutionReplayIntegrityReport = {
		valid: envelope.invariants.validated,
		violations: envelope.invariants.violations,
		checksum: envelope.checksum || computeSwarmArtifactChecksum(envelope),
	}

	return {
		schema: "execution.replay/v1",
		artifactId: envelope.swarmId,
		source,
		taskId: envelope.taskId,
		status: envelope.status,
		startedAt: envelope.timestamps.started,
		completedAt: envelope.timestamps.completed,
		lineage: [
			...(envelope.parentExecutionId
				? [
						{
							id: envelope.parentExecutionId,
							source,
							label: "parent execution",
							status: "completed",
							startedAt: envelope.timestamps.started,
							artifactPointer: {
								source,
								artifactId: envelope.parentExecutionId,
								label: "parent swarm artifact",
							},
						},
					]
				: []),
			{
				id: envelope.executionId,
				source,
				parentId: envelope.parentExecutionId,
				label: envelope.resumeAttemptId ? `resume ${envelope.resumeAttemptId}` : "swarm execution",
				status: envelope.status,
				startedAt: envelope.timestamps.started,
				completedAt: envelope.timestamps.completed,
				artifactPointer: {
					source,
					artifactId: envelope.swarmId,
					relativePath: envelope.artifactPath,
					label: "swarm envelope",
				},
				extension: envelope.resumeAttemptId ? { resumeAttemptId: envelope.resumeAttemptId } : undefined,
			},
			...envelope.agents.map((agent) => ({
				id: agent.executionId,
				source,
				parentId: envelope.executionId,
				label: agent.role,
				status: agent.status,
				startedAt: agent.timestamps.spawned,
				completedAt: agent.timestamps.completed,
				artifactPointer: agent.transcriptArtifactPath
					? {
							source,
							artifactId: agent.agentId,
							relativePath: agent.transcriptArtifactPath,
							label: "agent transcript",
						}
					: undefined,
				extension: {
					agentId: agent.agentId,
					evidenceCount: agent.evidenceRefs.length,
					compactionCount: agent.compactionEvents.length,
				},
			})),
		],
		timeline: envelope.agents.flatMap((agent) => [
			...agent.toolSteps.map((step) => ({
				id: `${agent.agentId}_tool_${step.index}`,
				timestamp: step.timestamp,
				kind: "tool_call",
				source,
				label: step.toolName,
				contentKind: "raw" as const,
				detail: { preview: step.preview, touchedPaths: step.touchedPaths },
			})),
			...agent.compactionEvents.map((event) => ({
				id: event.id,
				timestamp: event.timestamp,
				kind: "compaction",
				source,
				label: event.reason,
				contentKind: "summary" as const,
				detail: {
					droppedRange: event.droppedRange,
					continuityRiskLevel: event.continuityRiskLevel,
				},
			})),
		]),
		checkpoints: [
			{
				id: envelope.continuity.resumeToken,
				timestamp: envelope.continuity.lastPersistedAt,
				label: "continuity checkpoint",
				artifactPointer: {
					source,
					artifactId: envelope.swarmId,
					relativePath: envelope.artifactPath,
					label: "swarm envelope",
				},
				resumeToken: envelope.continuity.resumeToken,
			},
		],
		artifactPointers: [
			{
				source,
				artifactId: envelope.swarmId,
				relativePath: envelope.artifactPath,
				label: "swarm envelope",
			},
			...envelope.agents
				.filter((agent) => agent.transcriptArtifactPath)
				.map((agent) => ({
					source,
					artifactId: agent.agentId,
					relativePath: agent.transcriptArtifactPath,
					label: `${agent.role} transcript`,
				})),
		],
		integrity,
		extension: {
			blackboardSnapshot: envelope.blackboardSnapshot,
			summaryOverlay: envelope.summaryOverlay,
			recoveryReceipt: envelope.recoveryReceipt,
		},
	}
}

export interface BroccoliReplayInput {
	sessionId: string
	mode: string
	status: string
	startedAt: number
	completedAt?: number
	taskId?: string
	journalCount: number
	eventCount: number
	traceCount: number
	failureReason?: string | null
}

export function broccoliReplayToArtifact(input: BroccoliReplayInput): ExecutionReplayArtifact {
	const source: ExecutionReplaySource = "broccoli"
	return {
		schema: "execution.replay/v1",
		artifactId: input.sessionId,
		source,
		taskId: input.taskId || input.sessionId,
		status: input.status,
		startedAt: input.startedAt,
		completedAt: input.completedAt,
		lineage: [
			{
				id: input.sessionId,
				source,
				label: `broccoli session (${input.mode})`,
				status: input.status,
				startedAt: input.startedAt,
				completedAt: input.completedAt,
				extension: {
					mode: input.mode,
					journalCount: input.journalCount,
					eventCount: input.eventCount,
					traceCount: input.traceCount,
					failureReason: input.failureReason ?? null,
				},
			},
		],
		timeline: [],
		checkpoints: [],
		artifactPointers: [
			{
				source,
				artifactId: input.sessionId,
				label: "broccoli runtime session",
			},
		],
		integrity: { valid: true, violations: [] },
		extension: {
			broccoli: {
				mode: input.mode,
				journalCount: input.journalCount,
				eventCount: input.eventCount,
				traceCount: input.traceCount,
			},
		},
	}
}

export function verifyReplayArtifact(artifact: ExecutionReplayArtifact): ExecutionReplayIntegrityReport {
	const violations: string[] = []

	if (artifact.schema !== "execution.replay/v1") {
		violations.push("unsupported replay schema")
	}
	if (!artifact.artifactId?.trim()) {
		violations.push("missing artifact id")
	}
	if (!artifact.taskId?.trim()) {
		violations.push("missing task id")
	}
	if (!artifact.lineage.length) {
		violations.push("missing lineage nodes")
	}
	if (!artifact.artifactPointers.length) {
		violations.push("missing artifact pointers")
	}

	return {
		valid: violations.length === 0,
		violations,
		checksum: artifact.integrity.checksum,
	}
}

export function mergeReplayLineage(artifacts: ExecutionReplayArtifact[]): ExecutionReplayArtifact["lineage"] {
	const nodes = artifacts.flatMap((artifact) => artifact.lineage)
	const seen = new Set<string>()
	return nodes.filter((node) => {
		if (seen.has(node.id)) {
			return false
		}
		seen.add(node.id)
		return true
	})
}
