import type { GateReasonCode } from "./gateReasonCodes"
import type { GateLifecycleTransitionRecord } from "./lifecycleTransitionLog"

export type FinalizationStatus = "pending" | "running" | "passed" | "failed" | "idempotent_replay"

export interface FinalizationEvidence {
	finalizationRunId: string
	status: FinalizationStatus
	docsUpdated: string[]
	ledgerStamped: boolean
	roadmapValidated: boolean
	schemaValidationPassed: boolean
	artifactPaths: string[]
	changelogEntryPreview?: string
	completedAt?: number
	accessDeniedReason?: string
}

export interface CompletionReceipt {
	receiptId: string
	taskId: string
	outcome: "completed" | "completed_without_retry_completion"
	engineeringVerifiedAt: number
	engineeringCheckpointHash?: string
	auditScore?: number
	finalizationEvidence: FinalizationEvidence
	changedFilesSummary?: string
	gateReasonCode: GateReasonCode
	lifecycleTransitionHistory: GateLifecycleTransitionRecord[]
	continuityMarker: string
	sealedAt: number
	operatorVisible: true
}
