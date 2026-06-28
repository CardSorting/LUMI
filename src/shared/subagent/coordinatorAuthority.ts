/**
 * Coordinator-owned live authority vs advisory receipt artifacts (ADR-015).
 * Shared types for diagnostics surfaced on receipts and completion gate telemetry.
 */

export type GovernanceDiagnosticCode =
	| "governance_recursion_detected"
	| "duplicate_audit_path_detected"
	| "stale_receipt_authority_detected"
	| "no_progress_execution_loop"

export interface GovernanceDiagnosticEvent {
	code: GovernanceDiagnosticCode
	message: string
	at: number
}

export interface CoordinatorHaltDecision {
	/** Whether execution should halt after coordinator reconciliation. */
	shouldHalt: boolean
	/** Human-readable halt reason when shouldHalt is true. */
	reason?: string
	/** Forensic diagnostics emitted during reconciliation. */
	diagnostics: GovernanceDiagnosticEvent[]
	/** True when the only evidence for halt was a non-authoritative receipt artifact. */
	receiptDerivedOnly: boolean
}

export interface CoordinatorContinuationContext {
	taskId: string
	swarmId?: string
	attemptId?: string
	parentAttemptId?: string
	/** Authoritative sealed attempt from history, if any. */
	authoritativeAttemptId?: string
	/** Latest pointer attempt id (may be stale failed retry). */
	latestPointerAttemptId?: string
	/** Live lane DAG has running nodes. */
	hasRunningLanes?: boolean
}

export interface CoordinatorHaltRequest {
	/** Proposed blocking reason from receipt/audit/gate artifact. */
	proposedReason: string
	/** Artifact class that proposed the block. */
	source: "receipt_pointer" | "merge_gate" | "audit_preflight" | "completion_gate" | "lane_gate"
	context: CoordinatorContinuationContext
}
