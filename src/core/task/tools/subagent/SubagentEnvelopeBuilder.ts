import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import type { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import type {
	CompactionEventRecord,
	EvidenceReference,
	ExecutionConfidence,
	StructuredFinding,
	SubagentExecutionEnvelope,
	SubagentExecutionPhase,
	SubagentToolStepRecord,
} from "@shared/subagent/executionEnvelope"

const FILE_TOOL_PARAMS = new Set(["path", "file_path", "target_file"])

function extractTouchedPaths(params: Record<string, string>): string[] {
	const paths: string[] = []
	for (const key of FILE_TOOL_PARAMS) {
		const value = params[key]?.trim()
		if (value) {
			paths.push(value)
		}
	}
	return paths
}

function excerpt(text: string, maxChars = 500): string {
	const trimmed = text.trim()
	if (trimmed.length <= maxChars) {
		return trimmed
	}
	return `${trimmed.slice(0, maxChars)}...`
}

function hashId(seed: string): string {
	let hash = 2166136261
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}

export class SubagentEnvelopeBuilder {
	private phase: SubagentExecutionPhase = "spawned"
	private status: SubagentExecutionStatus = "pending"
	private toolSteps: SubagentToolStepRecord[] = []
	private evidenceRefs: EvidenceReference[] = []
	private structuredFindings: StructuredFinding[] = []
	private touchedFiles = new Set<string>()
	private blockers: string[] = []
	private warnings: string[] = []
	private retryHints: string[] = []
	private verbatimOutput?: string
	private gateLifecycleStatus?: GateLifecycleDecision
	private compactionEvents: CompactionEventRecord[] = []
	private transcriptArtifactPath?: string
	private transcriptEventCount?: number
	private transcriptByteSize?: number
	private error?: string
	private confidence: ExecutionConfidence = "unknown"
	private readonly spawnedAt: number

	constructor(
		private readonly agentId: string,
		private readonly executionId: string,
		private readonly role: string,
		private readonly parentSwarmId: string,
		private readonly parentTaskId: string,
		private readonly prompt: string,
		private readonly lineage: { swarmId: string; index: number; depth: number },
		private readonly parentStreamId?: string,
		private readonly childStreamId?: string,
	) {
		this.spawnedAt = Date.now()
	}

	setPhase(phase: SubagentExecutionPhase): void {
		this.phase = phase
	}

	setStatus(status: SubagentExecutionStatus): void {
		this.status = status
		if (status === "running" && this.phase === "spawned") {
			this.phase = "running"
		}
	}

	recordToolStep(toolName: string, preview: string, result: string, params: Record<string, string>): void {
		const touchedPaths = extractTouchedPaths(params)
		for (const touchedPath of touchedPaths) {
			this.touchedFiles.add(touchedPath)
		}

		const step: SubagentToolStepRecord = {
			index: this.toolSteps.length,
			toolName,
			preview,
			resultExcerpt: excerpt(result),
			timestamp: Date.now(),
			touchedPaths,
		}
		this.toolSteps.push(step)
		this.phase = "tool_execution"

		const evidenceId = `evidence_${this.agentId}_tool_${step.index}`
		this.evidenceRefs.push({
			id: evidenceId,
			kind: "tool_output",
			label: `${toolName} step ${step.index + 1}`,
			excerpt: step.resultExcerpt,
			path: touchedPaths[0],
			timestamp: step.timestamp,
		})
	}

	recordBlocker(message: string): void {
		this.blockers.push(message)
		this.structuredFindings.push({
			id: `finding_${hashId(message)}`,
			summary: message,
			severity: "blocker",
			source: "gate",
			confidence: "high",
			evidenceIds: [],
		})
	}

	recordGateLifecycle(decision: GateLifecycleDecision): void {
		this.gateLifecycleStatus = decision
	}

	recordWarning(message: string): void {
		this.warnings.push(message)
		this.structuredFindings.push({
			id: `finding_${hashId(message)}`,
			summary: message,
			severity: "warning",
			source: "inferred",
			confidence: "medium",
			evidenceIds: [],
		})
	}

	recordRetryHint(hint: string): void {
		this.retryHints.push(hint)
	}

	recordCompaction(event: CompactionEventRecord): void {
		this.compactionEvents.push(event)
		this.recordWarning(
			`Context compaction (${event.reason}): dropped messages ${event.droppedRange[0]}-${event.droppedRange[1]}. Continuity risk: ${event.continuityRiskLevel}.`,
		)
	}

	setTranscriptMeta(artifactPath: string, eventCount: number, byteSize: number): void {
		this.transcriptArtifactPath = artifactPath
		this.transcriptEventCount = eventCount
		this.transcriptByteSize = byteSize
	}

	setParentExecutionId(parentExecutionId: string): void {
		this.lineageParentExecutionId = parentExecutionId
	}

	private lineageParentExecutionId?: string

	complete(result: string, confidence: ExecutionConfidence = "high"): void {
		this.verbatimOutput = result
		this.status = "completed"
		this.phase = "completed"
		this.confidence = confidence

		const evidenceId = `evidence_${this.agentId}_verbatim`
		this.evidenceRefs.push({
			id: evidenceId,
			kind: "artifact",
			label: "verbatim completion output",
			excerpt: excerpt(result, 1000),
			timestamp: Date.now(),
		})
		this.structuredFindings.push({
			id: `finding_${this.agentId}_completion`,
			summary: excerpt(result, 200),
			severity: "info",
			source: "verbatim",
			confidence,
			evidenceIds: [evidenceId],
		})
	}

	fail(error: string): void {
		this.error = error
		this.status = "failed"
		this.phase = "failed"
		this.confidence = "low"
		this.recordWarning(error)
	}

	abort(): void {
		this.status = "failed"
		this.phase = "aborted"
		this.error = this.error || "Subagent run aborted."
	}

	build(): SubagentExecutionEnvelope {
		return {
			agentId: this.agentId,
			executionId: this.executionId,
			role: this.role,
			parentSwarmId: this.parentSwarmId,
			parentTaskId: this.parentTaskId,
			parentStreamId: this.parentStreamId,
			childStreamId: this.childStreamId,
			parentExecutionId: this.lineageParentExecutionId,
			lineage: this.lineage,
			phase: this.phase,
			status: this.status,
			prompt: this.prompt,
			verbatimOutput: this.verbatimOutput,
			structuredFindings: this.structuredFindings,
			evidenceRefs: this.evidenceRefs,
			touchedFiles: Array.from(this.touchedFiles),
			toolSteps: this.toolSteps,
			compactionEvents: this.compactionEvents,
			blockers: this.blockers,
			warnings: this.warnings,
			gateLifecycleStatus: this.gateLifecycleStatus,
			confidence: this.confidence,
			retryHints: this.retryHints,
			transcriptArtifactPath: this.transcriptArtifactPath,
			transcriptEventCount: this.transcriptEventCount,
			transcriptByteSize: this.transcriptByteSize,
			timestamps: {
				spawned: this.spawnedAt,
				started: this.status !== "pending" ? this.spawnedAt : undefined,
				completed: this.status === "completed" || this.status === "failed" ? Date.now() : undefined,
			},
			error: this.error,
		}
	}
}
