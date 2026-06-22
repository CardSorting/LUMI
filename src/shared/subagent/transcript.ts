export type SubagentTranscriptEventKind =
	| "llm_request"
	| "assistant_turn"
	| "tool_call"
	| "tool_response"
	| "system_event"
	| "compaction"
	| "error"
	| "recovery"
	| "completion"

export type TranscriptContentKind = "raw" | "summary" | "inferred"

export type CompactionContinuityRisk = "low" | "medium" | "high"

export interface TranscriptCompactionPayload {
	reason: string
	preTokenEstimate: number
	postTokenEstimate: number
	droppedRange: [number, number]
	preservedSummaryRef?: string
	continuityRiskLevel: CompactionContinuityRisk
	artifactPointer: string
	contentKind: "summary"
}

export interface SubagentTranscriptEvent {
	id: string
	sequence: number
	timestamp: number
	kind: SubagentTranscriptEventKind
	contentKind: TranscriptContentKind
	swarmId: string
	agentId: string
	taskId: string
	executionId: string
	payload: Record<string, unknown>
	checksum: string
}

export interface SubagentTranscriptMeta {
	swarmId: string
	agentId: string
	taskId: string
	executionId: string
	eventCount: number
	byteSize: number
	lineChecksum: string
	artifactPath: string
	schemaVersion: 1
}

export interface CompactionEventRecord extends TranscriptCompactionPayload {
	id: string
	timestamp: number
	executionId: string
	agentId: string
	transcriptSequence: number
}

export const TRANSCRIPT_SCHEMA_VERSION = 1 as const
export const TRANSCRIPT_MAX_EVENTS = 500
export const TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024

export function computeTranscriptLineChecksum(line: string): string {
	let hash = 2166136261
	for (let i = 0; i < line.length; i++) {
		hash ^= line.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}
