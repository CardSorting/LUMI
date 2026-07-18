import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import type { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import type { ExecutionFunnelEvent } from "@shared/execution/executionFunnelEvent"
import type { CompactionEventRecord } from "@shared/subagent/transcript"

export type SubagentExecutionPhase =
	| "spawned"
	| "running"
	| "tool_execution"
	| "completion_gate"
	| "completed"
	| "failed"
	| "aborted"

export type ExecutionConfidence = "high" | "medium" | "low" | "unknown"

export type ExecutionValidity = "valid" | "invalid"

export type FindingConfidenceReason =
	| "direct_evidence"
	| "indirect_evidence"
	| "underspecified_goal"
	| "conflicting_evidence"
	| "missing_context"
	| "exploratory_hypothesis"
	| "model_uncertainty"
	| "other"

export type FindingDecisionCriticality = "critical" | "important" | "advisory"

export type TaskAmbiguityReason =
	| "multiple_valid_interpretations"
	| "missing_success_criteria"
	| "missing_scope_boundary"
	| "insufficient_source_material"
	| "subjective_judgment"
	| "open_ended_exploration"
	| "conflicting_constraints"

export interface TaskAmbiguityProfile {
	detected: boolean
	reasons: TaskAmbiguityReason[]
	assumptionsAllowed: boolean
}

export type SwarmExecutionStatus = "running" | "completed" | "failed" | "interrupted"

export interface EvidenceReference {
	id: string
	kind: "file" | "tool_output" | "memory" | "artifact"
	path?: string
	label: string
	excerpt?: string
	timestamp: number
}

export interface StructuredFinding {
	id: string
	summary: string
	severity: "info" | "warning" | "blocker" | "critical"
	source: "verbatim" | "inferred" | "gate"
	confidence: ExecutionConfidence
	confidenceReason: FindingConfidenceReason
	evidenceIds: string[]
	assumptions: string[]
	decisionCriticality: FindingDecisionCriticality
	/** Optional structured conflict hints; the convergence gate owns final classification. */
	contradictsFindingIds?: string[]
}

export interface SubagentToolStepRecord {
	index: number
	toolName: string
	preview: string
	resultExcerpt: string
	timestamp: number
	touchedPaths: string[]
	params?: Record<string, string>
	/** Canonical per-invocation authority; handler text is evidence, never status. */
	executionFunnelEvent: ExecutionFunnelEvent
}

export interface SubagentExecutionEnvelope {
	agentId: string
	executionId: string
	role: string
	parentSwarmId: string
	parentTaskId: string
	parentStreamId?: string
	childStreamId?: string
	parentExecutionId?: string
	lineage: { swarmId: string; index: number; depth: number; resumeAttemptId?: string }
	phase: SubagentExecutionPhase
	status: SubagentExecutionStatus
	prompt: string
	verbatimOutput?: string
	structuredFindings: StructuredFinding[]
	evidenceRefs: EvidenceReference[]
	touchedFiles: string[]
	toolSteps: SubagentToolStepRecord[]
	compactionEvents: CompactionEventRecord[]
	blockers: string[]
	warnings: string[]
	completionFunnelEvent?: CompletionFunnelEvent
	executionValidity: ExecutionValidity
	confidence: ExecutionConfidence
	retryHints: string[]
	transcriptArtifactPath?: string
	transcriptEventCount?: number
	transcriptByteSize?: number
	timestamps: { spawned: number; started?: number; completed?: number }
	error?: string
}

export interface ExecutionContinuityMarker {
	swarmId: string
	taskId: string
	resumeToken: string
	lastPersistedAt: number
	completedAgents: number
	totalAgents: number
	status: SwarmExecutionStatus
}

export interface SwarmInvariantReport {
	validated: boolean
	violations: string[]
	advisoryWarnings?: string[]
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

export interface SwarmExecutionEnvelope {
	swarmId: string
	executionId: string
	taskId: string
	parentStreamId?: string
	parentExecutionId?: string
	resumeAttemptId?: string
	recoveryReceipt?: SwarmRecoveryReceipt
	taskAmbiguityProfile?: TaskAmbiguityProfile
	continuity: ExecutionContinuityMarker
	agents: SubagentExecutionEnvelope[]
	blackboardSnapshot: string[]
	summaryOverlay?: string
	timestamps: { started: number; completed?: number }
	status: SwarmExecutionStatus
	invariants: SwarmInvariantReport
	artifactPath: string
	schemaVersion: 1
	checksum?: string
}

export const SUBAGENT_EXECUTIONS_DIR = "subagent_executions"
export const SWARM_ENVELOPE_SCHEMA_VERSION = 1 as const
export const SWARM_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function buildTranscriptArtifactPath(swarmId: string, agentId: string): string {
	return `${SUBAGENT_EXECUTIONS_DIR}/${swarmId}/agents/${agentId}.transcript.jsonl`
}

export function buildArtifactPath(taskId: string, swarmId: string): string {
	return `${SUBAGENT_EXECUTIONS_DIR}/${swarmId}.json`
}

export function createContinuityMarker(
	swarmId: string,
	taskId: string,
	totalAgents: number,
	completedAgents: number,
	status: SwarmExecutionStatus,
): ExecutionContinuityMarker {
	return {
		swarmId,
		taskId,
		resumeToken: `${swarmId}:${completedAgents}:${Date.now()}`,
		lastPersistedAt: Date.now(),
		completedAgents,
		totalAgents,
		status,
	}
}
