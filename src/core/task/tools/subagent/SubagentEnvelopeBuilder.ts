import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import type { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import type {
	EvidenceReference,
	ExecutionConfidence,
	ExecutionValidity,
	FindingConfidenceReason,
	FindingDecisionCriticality,
	StructuredFinding,
	SubagentExecutionEnvelope,
	SubagentExecutionPhase,
	SubagentToolStepRecord,
} from "@shared/subagent/executionEnvelope"
import type { CompactionEventRecord } from "@shared/subagent/transcript"

const FILE_TOOL_PARAMS = new Set(["path", "file_path", "target_file"])

const EXPLICIT_CONFIDENCE = /\[confidence\s*:\s*(high|medium|low|unknown)\]/i
const EXPLICIT_CONFIDENCE_REASON =
	/\[confidence_reason\s*:\s*(direct_evidence|indirect_evidence|underspecified_goal|conflicting_evidence|missing_context|exploratory_hypothesis|model_uncertainty|other)\]/i
const EXPLICIT_CRITICALITY = /\[criticality\s*:\s*(critical|important|advisory)\]/i
const UNKNOWN_LANGUAGE =
	/\b(?:unknown|cannot determine|can't determine|insufficient evidence|no definitive answer|not enough (?:evidence|context))\b/i
const LOW_CONFIDENCE_LANGUAGE =
	/\b(?:low confidence|uncertain|unclear|tentative|hypothesis|hypothesize|may be|might be|could be)\b/i
const MEDIUM_CONFIDENCE_LANGUAGE = /\b(?:medium confidence|likely|probably|suggests?|indirect evidence)\b/i

export interface CompletionFindingMetadata {
	confidence: ExecutionConfidence
	confidenceReason: FindingConfidenceReason
	assumptions: string[]
	decisionCriticality: FindingDecisionCriticality
}

function extractAssumptions(result: string): string[] {
	const assumptions: string[] = []
	for (const line of result.split("\n")) {
		const match = line.match(/^\s*(?:[-*]\s*)?(?:assumption|assuming)\s*:\s*(.+)$/i)
		if (match?.[1]?.trim()) {
			assumptions.push(match[1].trim())
		}
	}
	for (const match of result.matchAll(/\[assumption\s*:\s*([^\]]+)\]/gi)) {
		if (match[1]?.trim()) {
			assumptions.push(match[1].trim())
		}
	}
	return [...new Set(assumptions)]
}

/** Preserve explicit model uncertainty; infer only when the result uses unambiguous uncertainty language. */
export function deriveCompletionFindingMetadata(
	result: string,
	options?: { confidence?: ExecutionConfidence; hasDirectEvidence?: boolean },
): CompletionFindingMetadata {
	const explicitConfidence = result.match(EXPLICIT_CONFIDENCE)?.[1]?.toLowerCase() as ExecutionConfidence | undefined
	const confidence =
		options?.confidence ??
		explicitConfidence ??
		(UNKNOWN_LANGUAGE.test(result)
			? "unknown"
			: LOW_CONFIDENCE_LANGUAGE.test(result)
				? "low"
				: MEDIUM_CONFIDENCE_LANGUAGE.test(result)
					? "medium"
					: "high")
	const explicitReason = result.match(EXPLICIT_CONFIDENCE_REASON)?.[1]?.toLowerCase() as FindingConfidenceReason | undefined
	const confidenceReason =
		explicitReason ??
		(/\b(?:underspecified|ambiguous|vague objective|missing success criteria)\b/i.test(result)
			? "underspecified_goal"
			: /\bconflicting evidence\b/i.test(result)
				? "conflicting_evidence"
				: /\b(?:missing context|insufficient evidence|not enough (?:evidence|context))\b/i.test(result)
					? "missing_context"
					: /\b(?:hypothesis|hypothesize|exploratory)\b/i.test(result)
						? "exploratory_hypothesis"
						: confidence === "low" || confidence === "unknown"
							? "model_uncertainty"
							: options?.hasDirectEvidence
								? "direct_evidence"
								: "indirect_evidence")
	const decisionCriticality =
		(result.match(EXPLICIT_CRITICALITY)?.[1]?.toLowerCase() as FindingDecisionCriticality | undefined) ?? "advisory"

	return { confidence, confidenceReason, assumptions: extractAssumptions(result), decisionCriticality }
}

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
	private completionFunnelEvent?: CompletionFunnelEvent
	private compactionEvents: CompactionEventRecord[] = []
	private transcriptArtifactPath?: string
	private transcriptEventCount?: number
	private transcriptByteSize?: number
	private error?: string
	private confidence: ExecutionConfidence = "unknown"
	private executionValidity: ExecutionValidity = "invalid"
	private readonly spawnedAt: number

	constructor(
		private readonly agentId: string,
		private readonly executionId: string,
		private readonly role: string,
		private readonly parentSwarmId: string,
		private readonly parentTaskId: string,
		private readonly prompt: string,
		private readonly lineage: { swarmId: string; index: number; depth: number; resumeAttemptId?: string },
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
			params,
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
			confidenceReason: "direct_evidence",
			evidenceIds: [],
			assumptions: [],
			decisionCriticality: "critical",
		})
	}

	recordCompletionFunnel(event: CompletionFunnelEvent): void {
		this.completionFunnelEvent = event
	}

	recordWarning(message: string): void {
		this.warnings.push(message)
		this.structuredFindings.push({
			id: `finding_${hashId(message)}`,
			summary: message,
			severity: "warning",
			source: "inferred",
			confidence: "medium",
			confidenceReason: "indirect_evidence",
			evidenceIds: [],
			assumptions: [],
			decisionCriticality: "advisory",
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

	complete(result: string, confidence?: ExecutionConfidence): void {
		this.verbatimOutput = result
		this.status = "completed"
		this.phase = "completed"
		this.executionValidity = "valid"
		const metadata = deriveCompletionFindingMetadata(result, {
			confidence,
			hasDirectEvidence: this.toolSteps.length > 0,
		})
		this.confidence = metadata.confidence

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
			confidence: metadata.confidence,
			confidenceReason: metadata.confidenceReason,
			evidenceIds: this.evidenceRefs.map((evidence) => evidence.id),
			assumptions: metadata.assumptions,
			decisionCriticality: metadata.decisionCriticality,
		})
	}

	fail(error: string): void {
		this.error = error
		this.status = "failed"
		this.phase = "failed"
		this.executionValidity = "invalid"
		this.confidence = "unknown"
		this.recordWarning(error)
	}

	abort(): void {
		this.status = "failed"
		this.phase = "aborted"
		this.error = this.error || "Subagent run aborted."
		this.executionValidity = "invalid"
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
			completionFunnelEvent: this.completionFunnelEvent,
			executionValidity: this.executionValidity,
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
