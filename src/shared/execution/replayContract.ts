export type ExecutionReplaySource = "swarm" | "broccoli" | "external"

export interface ExecutionArtifactPointer {
	source: ExecutionReplaySource
	artifactId: string
	relativePath?: string
	label: string
}

export interface ExecutionLineageNode {
	id: string
	source: ExecutionReplaySource
	parentId?: string
	label: string
	status: string
	startedAt: number
	completedAt?: number
	artifactPointer?: ExecutionArtifactPointer
	extension?: Record<string, unknown>
}

export interface ExecutionTimelineEvent {
	id: string
	timestamp: number
	kind: string
	source: ExecutionReplaySource
	label: string
	contentKind: "raw" | "summary" | "inferred"
	detail?: Record<string, unknown>
}

export interface ExecutionCheckpoint {
	id: string
	timestamp: number
	label: string
	artifactPointer: ExecutionArtifactPointer
	resumeToken?: string
}

export interface ExecutionReplayIntegrityReport {
	valid: boolean
	violations: string[]
	checksum?: string
}

export interface ExecutionReplayArtifact {
	schema: "execution.replay/v1"
	artifactId: string
	source: ExecutionReplaySource
	taskId: string
	status: string
	startedAt: number
	completedAt?: number
	lineage: ExecutionLineageNode[]
	timeline: ExecutionTimelineEvent[]
	checkpoints: ExecutionCheckpoint[]
	artifactPointers: ExecutionArtifactPointer[]
	integrity: ExecutionReplayIntegrityReport
	extension: Record<string, unknown>
}
