import type { ExecutionReplayIntegrityReport } from "@shared/execution/replayContract"
import type { LockBackends, LockClaim } from "@shared/governance/lockTypes"
import type {
	EvidenceReference,
	ExecutionConfidence,
	ExecutionValidity,
	FindingConfidenceReason,
	FindingDecisionCriticality,
	TaskAmbiguityProfile,
} from "@shared/subagent/executionEnvelope"
import type {
	AgentRoadmapProjection,
	LocalRoadmapEvent,
	ProposedWorkspacePatch,
	RoadmapPatchReconciliation,
	RoadmapWorkspaceCommitResult,
	SwarmRoadmapPlan,
} from "@shared/subagent/roadmapProjection"

export type {
	AgentRoadmapProjection,
	LocalRoadmapEvent,
	ProposedWorkspacePatch,
	RoadmapPatchReconciliation,
	RoadmapWorkspaceCommitResult,
	SwarmRoadmapPlan,
} from "@shared/subagent/roadmapProjection"

export const GOVERNED_RECEIPT_SCHEMA_VERSION = 3 as const

export type LaneExecutionMode =
	| "read_only"
	| "audit_only"
	| "planning_only"
	| "documentation_only"
	| "diagnostic_only"
	| "mutation"

export type LaneDAGState = "ready" | "blocked" | "running" | "sealed" | "failed"

export interface LaneDAGNode {
	index: number
	laneId: string
	dependsOn: number[]
	state: LaneDAGState
	agentId?: string
	executionMode?: LaneExecutionMode
	error?: string
}

export interface GovernedAdmissionResult {
	admitted: boolean
	backoffMs: number
	pressureScore?: number
	reason?: string
	operation?: string
	roadmapEnabled?: boolean
}

export interface WorkLaneClaim {
	laneId: string
	swarmId: string
	agentId: string
	index: number
	roadmapLeaseTaskId: string
	claimedAt: number
	expiresAt?: string
	lockClaim?: LockClaim
	executionMode: LaneExecutionMode
	lockRequired: boolean
	lockSkipped?: boolean
	reasonLockSkipped?: string
	reasonLockAcquired?: string
	readSet?: string[]
	writeSet?: string[]
	roadmapItemId?: string
	roadmapReadSet?: string[]
	roadmapWriteSet?: string[]
	roadmapMutationLockRequired?: boolean
	roadmapResourceKeys?: string[]
	roadmapLockClaims?: import("@shared/governance/lockTypes").LockClaim[]
	reasonRoadmapLockAcquired?: string
	agentRoadmap?: AgentRoadmapProjection
}

export type LaneExecutionStatus = "completed" | "failed" | "skipped" | "collision_rejected" | "blocked" | "running"

export interface LaneExecutionReceipt {
	laneId: string
	agentId: string
	index: number
	status: LaneExecutionStatus
	/** Additive v3 fields; absent only on historical receipts. */
	executionValidity?: ExecutionValidity
	findingConfidence?: ExecutionConfidence
	confidenceReason?: FindingConfidenceReason
	dagState?: LaneDAGState
	attemptId?: string
	claimId?: string
	claimReleased: boolean
	evidenceCount: number
	touchedFiles: string[]
	transcriptArtifactPath?: string
	toolStepCount?: number
	sealedAt: number
	acquiredAt?: number
	fencingToken?: string | number
	leaseEpoch?: string | number
	releasedAt?: number
	lockBackends?: LockBackends
	placeholderWarnings?: string[]
	auditResult?: "passed" | "failed"
	replayChecksum?: string
	error?: string
	executionMode: LaneExecutionMode
	lockRequired: boolean
	reasonLockSkipped?: string
	reasonLockAcquired?: string
	readSet?: string[]
	writeSet?: string[]
	roadmapLeaseTaskId?: string
	roadmapItemId?: string
	completionAuditPhase?: string
	roadmapReadSet?: string[]
	roadmapWriteSet?: string[]
	roadmapMutationLockRequired?: boolean
	roadmapMutationClaimReleased?: boolean
	roadmapResourceKeys?: string[]
	roadmapItemOwner?: string
	reasonRoadmapLockAcquired?: string
	agentRoadmapId?: string
	roadmapSnapshotId?: string
	projectedItems?: string[]
	localRoadmapEvents?: LocalRoadmapEvent[]
	proposedWorkspacePatch?: ProposedWorkspacePatch[]
	directWorkspaceRoadmapMutation?: boolean
	localEventContainmentViolations?: string[]
	sourceAuthority?: {
		sourceSwarmId: string
		sourceAttemptId: string
		sourceLaneId: string
		sourceAgentId: string
	}
}

export type ClaimHistoryEvent = "acquired" | "released" | "rejected" | "stale_detected" | "recovered"

export interface ClaimHistoryEntry {
	claimId?: string
	laneId: string
	resourceKey: string
	ownerId: string
	fencingToken: string | number
	event: ClaimHistoryEvent
	timestamp: number
	lockBackends?: LockBackends
	expiresAt?: number
	error?: string
}

export interface MergePathOverlap {
	path: string
	agents: string[]
}

export interface MergeRoadmapOverlap {
	resource: string
	agents: string[]
}

export interface MergeRoadmapAudit {
	safe: boolean
	violations: string[]
	overlappingResources: MergeRoadmapOverlap[]
	blockedWriters: string[]
}

export interface MergeSafetyAudit {
	safe: boolean
	violations: string[]
	overlappingPaths: MergePathOverlap[]
	missingEvidence: string[]
	placeholderWarnings: string[]
}

export type MergeGateFindingSeverity = "blocking" | "advisory"

export type MergeGateRetryDisposition =
	| "not_needed"
	| "targeted_probe"
	| "targeted_repair"
	| "retry_after_recovery"
	| "do_not_retry"

export type ContradictionKind =
	| "different_scope"
	| "different_assumption"
	| "different_timeframe"
	| "evidence_conflict"
	| "mutually_exclusive_claim"
	| "mutation_conflict"

export interface GovernedFinding {
	id: string
	laneId: string
	claim: string
	confidence: ExecutionConfidence
	confidenceReason: FindingConfidenceReason
	evidenceRefs: EvidenceReference[]
	assumptions: string[]
	decisionCriticality: FindingDecisionCriticality
}

export interface RejectedFinding {
	finding: GovernedFinding
	reason: string
}

export interface GovernedContradiction {
	id: string
	kind: ContradictionKind
	findingIds: string[]
	summary: string
	critical: boolean
	resolved: boolean
	preferredFindingId?: string
}

export type ConfidenceProbeReason = "critical_claim_unverified" | "mutually_exclusive_critical_claim" | "evidence_conflict"

export interface ConfidenceProbeHistoryEntry {
	probeId: string
	claimId: string
	question: string
	sourceLaneIds: string[]
	reason: ConfidenceProbeReason
	attempt: number
	launchedAt: number
	completedAt?: number
	evidenceRefs: EvidenceReference[]
	evidenceDelta: string[]
	principalClaims: string[]
	findingConfidence: ExecutionConfidence
	confidenceReason: FindingConfidenceReason
	toolSequence: string[]
	fingerprint: string
	status: "launched" | "completed" | "failed" | "exhausted"
	confidencePlateau: boolean
}

export interface ConvergenceEvidence {
	acceptedFindingIds: string[]
	tentativeFindingIds: string[]
	rejectedFindingIds: string[]
	usableLaneIds: string[]
}

export interface UncertaintySummary {
	causes: string[]
	affectedClaims: string[]
	safeToProceed: boolean
	resolutionEvidenceNeeded: string[]
}

export type StructuralFailureReason =
	| "structurally_invalid_result_envelope"
	| "lane_execution_failed"
	| "required_evidence_omitted"
	| "recoverable_governance_failure"

export type HardFailureReason =
	| "invalid_governed_receipt"
	| "receipt_integrity_violation"
	| "mutation_authority_violation"
	| "unreconciled_mutation_conflict"
	| "execution_provenance_corrupt"
	| "every_lane_failed"
	| "unsafe_under_all_interpretations"
	| "required_invariant_violated"

export type ConvergenceGateDecision =
	| { kind: "converge"; evidence: ConvergenceEvidence }
	| { kind: "converge_with_uncertainty"; evidence: ConvergenceEvidence; uncertainty: UncertaintySummary }
	| {
			kind: "targeted_probe"
			question: string
			sourceLaneIds: string[]
			reason: ConfidenceProbeReason
	  }
	| { kind: "restart_invalid_lane"; laneId: string; reason: StructuralFailureReason }
	| { kind: "block_hard_failure"; reason: HardFailureReason }

export type ConvergenceDiagnostic =
	| "execution_invalid"
	| "finding_low_confidence"
	| "task_ambiguous"
	| "critical_claim_unverified"
	| "confidence_plateau"
	| "converged_with_uncertainty"
	| "hard_blocked"

export interface ConfidenceAwareConvergenceDiagnostics {
	events: ConvergenceDiagnostic[]
	lowConfidenceLanesAccepted: number
	confidenceOnlyRetriesSuppressed: number
	targetedProbesLaunched: number
	probeBudgetsExhausted: number
	convergedWithBoundedUncertainty: number
	trueHardBlocks: number
	contradictionClassifications: Partial<Record<ContradictionKind, number>>
	confidenceChanges: Array<{
		findingId: string
		from: ExecutionConfidence
		to: ExecutionConfidence
		evidenceDelta: string[]
	}>
}

export interface ConfidenceAwareConvergenceResult {
	decision: "converge" | "converge_with_uncertainty" | "targeted_probe" | "restart_invalid_lane" | "block_hard_failure"
	gateDecision: ConvergenceGateDecision
	acceptedFindings: GovernedFinding[]
	tentativeFindings: GovernedFinding[]
	rejectedFindings: RejectedFinding[]
	unresolvedContradictions: GovernedContradiction[]
	assumptions: string[]
	taskAmbiguityProfile: TaskAmbiguityProfile
	probeHistory: ConfidenceProbeHistoryEntry[]
	confidencePlateau: boolean
	uncertaintySummary?: UncertaintySummary
	diagnostics: ConfidenceAwareConvergenceDiagnostics
}

export type GovernedContinuationAction =
	| "accept"
	| "accept_with_advisories"
	| "targeted_probe"
	| "targeted_repair"
	| "recover_and_resume"
	| "halt_for_conflict"
	| "reject_invalid_result"

export interface GovernedContinuationDecision {
	action: GovernedContinuationAction
	retryDisposition: MergeGateRetryDisposition
	reasonCode: string
	cleanPath: boolean
	permittedAction: "continue_parent" | "repair_lanes" | "recover_state" | "halt" | "reject"
}

/** Testable counters for the parent critical path; persisted with the receipt for diagnostics. */
export interface GovernedExecutionPathMetrics {
	envelopeValidationCalls: number
	envelopeValidationReuses: number
	replayValidationCalls: number
	claimReconstructions: number
	receiptContextReads: number
	receiptHistoryReads: number
	envelopePersistenceWrites: number
	receiptPersistenceWrites: number
	continuationReductions: number
	retryDecisions: number
	lockAcquisitions: number
	lowConfidenceLanesAccepted: number
	confidenceOnlyRetriesSuppressed: number
	targetedProbesLaunched: number
	probeBudgetsExhausted: number
	convergedWithBoundedUncertainty: number
	trueHardBlocks: number
}

/** Structured gate result so callers do not infer retry behavior from human-readable strings. */
export interface MergeGateFinding {
	code: string
	severity: MergeGateFindingSeverity
	message: string
	retryable: boolean
	remediation?: string
}

export interface MergeGateResult {
	passed: boolean
	mergeAudit: MergeSafetyAudit
	roadmapAudit?: MergeRoadmapAudit
	replayIntegrity: ExecutionReplayIntegrityReport
	violations: string[]
	failedLaneCount: number
	orphanedClaimCount: number
	staleLeaseCount: number
	splitBrainDetected: boolean
	sealedSupersessionBlocked: boolean
	/** Added in schema v3 as backward-compatible fields for older persisted receipts. */
	findings?: MergeGateFinding[]
	advisoryWarnings?: string[]
	retryDisposition?: MergeGateRetryDisposition
	confidenceAwareConvergence?: ConfidenceAwareConvergenceResult
}

export interface GovernedClaimTimelineEntry {
	label: string
	event: ClaimHistoryEvent | "admitted" | "audited" | "sealed" | "rejected" | "merge_blocked"
	timestamp: number
	laneId?: string
	claimId?: string
	status: "ok" | "blocked" | "failed"
}

export interface GovernedResourceOwner {
	resourceKey: string
	ownerId: string
	laneId?: string
	fencingToken: string | number
	leaseEpoch?: string | number
	claimId?: string
	lockBackends?: LockBackends
	status: "active" | "released" | "stale" | "recovered"
}

export interface GovernedRetryHistoryEntry {
	attemptId: string
	parentAttemptId?: string
	sealed: boolean
	mergePassed: boolean
	timestamp: number
	retryReason?: string
}

export type GovernedReceiptIncident =
	| "sealed_success"
	| "partial_receipt"
	| "failed_receipt"
	| "stale_claim"
	| "unsafe_retry"
	| "corrupted_receipt"
	| "replay_mismatch"
	| "backend_unavailable"
	| "merge_blocked"
	| "in_progress"

export interface GovernedReceiptDiagnostics {
	incident: GovernedReceiptIncident
	incidentSummary: string
	retrySafe: boolean
	retryUnsafeReason?: string
	authoritativeAttemptId?: string
	activeResourceOwners: GovernedResourceOwner[]
	staleResourceOwners: GovernedResourceOwner[]
	overlappingPaths: MergePathOverlap[]
	overlappingRoadmapResources?: MergeRoadmapOverlap[]
	blockedRoadmapWriters?: string[]
	roadmapCompletionAdvisory?: string
	workspaceRoadmapSnapshotId?: string
	staleProjectionWarnings?: string[]
	rebaseResults?: import("@shared/subagent/roadmapProjection").PatchRebaseResult[]
	rejectedPatchReasons?: string[]
	roadmapCommitStatus?: string
	governanceWarnings?: string[]
	missingTranscripts: string[]
	missingToolEvidence: string[]
	replayMismatchCauses: string[]
	advisoryWarnings?: string[]
	retryDisposition?: MergeGateRetryDisposition
	convergenceDiagnostics?: ConfidenceAwareConvergenceDiagnostics
}

export interface GovernedReceiptSummary {
	swarmId: string
	attemptId: string
	parentAttemptId?: string
	admitted: boolean
	admissionReason?: string
	mergePassed: boolean
	sealed: boolean
	laneCount: number
	lanesSealed: number
	lanesFailed: number
	lanesBlocked: number
	lanesRunning: number
	collisionRejections: number
	orphanedClaims: number
	integrityValid: boolean
	evidenceComplete: boolean
	replayChecksum?: string
	replayIntegrityValid: boolean
	splitBrainDetected: boolean
	governedArtifactPath: string
	replayArtifactPath: string
	violations: string[]
	advisoryWarnings?: string[]
	retryDisposition?: MergeGateRetryDisposition
	continuationDecision?: GovernedContinuationDecision
	executionPathMetrics?: GovernedExecutionPathMetrics
	confidenceAwareConvergence?: ConfidenceAwareConvergenceResult
	laneStates: Array<{
		index: number
		laneId: string
		status: LaneExecutionStatus
		executionValidity?: ExecutionValidity
		findingConfidence?: ExecutionConfidence
		confidenceReason?: FindingConfidenceReason
		dagState?: LaneDAGState
		claimId?: string
		evidenceCount?: number
		executionMode?: LaneExecutionMode
		lockRequired?: boolean
		reasonLockSkipped?: string
		reasonLockAcquired?: string
		readSet?: string[]
		writeSet?: string[]
		roadmapReadSet?: string[]
		roadmapWriteSet?: string[]
		roadmapMutationLockRequired?: boolean
		roadmapMutationClaimReleased?: boolean
		roadmapResourceKeys?: string[]
		roadmapItemOwner?: string
		reasonRoadmapLockAcquired?: string
		agentRoadmapId?: string
		roadmapSnapshotId?: string
		projectedItems?: string[]
		localRoadmapEvents?: LocalRoadmapEvent[]
		proposedWorkspacePatch?: ProposedWorkspacePatch[]
	}>
	laneDag: LaneDAGNode[]
	claimTimeline: GovernedClaimTimelineEntry[]
	resourceOwners: GovernedResourceOwner[]
	retryHistory: GovernedRetryHistoryEntry[]
	diagnostics: GovernedReceiptDiagnostics
	roadmapLinkage?: GovernedRoadmapLinkage
}

export interface GovernedRoadmapLinkage {
	operation?: string
	roadmapEnabled: boolean
	pressureScore?: number
	nowItemCount?: number
	validationPending?: boolean
	kanbanCompleteAllowed?: boolean
	orchestrationLeaseTaskIds: string[]
	laneRoadmapItems: Array<{
		index: number
		laneId: string
		roadmapItemId?: string
		roadmapLeaseTaskId: string
	}>
	completionAdvisory?: string
	incompleteIntegration?: string[]
	orchestrationLease?: GovernedOrchestrationLease
	completionPolicy?: RoadmapCompletionUpdatePolicy
	completionOutcome?: RoadmapCompletionOutcome
	workspaceRoadmapSnapshotId?: string
	swarmRoadmapPlan?: SwarmRoadmapPlan
	agentProjections?: Array<{
		agentRoadmapId: string
		laneId: string
		agentId: string
		projectedItems: string[]
	}>
	patchReconciliation?: RoadmapPatchReconciliation
	workspaceCommit?: RoadmapWorkspaceCommitResult
}

export interface GovernedAuditIntegration {
	preflightIssues: Array<{ stage: string; message: string; severity?: string }>
	perLaneCompletionAudit: Array<{
		index: number
		agentId: string
		phase?: string
		blocked?: boolean
	}>
	mergeGateRole: "commit_barrier"
	workspaceAuditAtPreflight: boolean
	workspaceAuditAtSeal: boolean
	receiptIntegrityValidated: boolean
	falsePositiveLockAudit: { lockSkippedCount: number; missingLockViolations: number }
	storageBoundary: string
	roadmapCompletionAdvisory?: string
	workspaceRoadmapSnapshotId?: string
	staleProjectionWarnings?: string[]
	roadmapCommitStatus?: string
	/** Coordinator authority diagnostics — advisory forensic signals (ADR-015). */
	governanceDiagnostics?: Array<{ code: string; message: string; at: number }>
}

export type GovernedCrashPhase =
	| "after_claim_before_execution"
	| "during_lane_execution"
	| "after_execution_before_release"
	| "after_release_before_seal"
	| "parent_before_merge_gate"
	| "retry_partial_seal"

export interface GovernedSwarmReceipt {
	schemaVersion: typeof GOVERNED_RECEIPT_SCHEMA_VERSION
	swarmId: string
	executionId: string
	taskId: string
	attemptId: string
	parentAttemptId?: string
	admission: GovernedAdmissionResult
	laneReceipts: LaneExecutionReceipt[]
	laneDag: LaneDAGNode[]
	claimHistory: ClaimHistoryEntry[]
	mergeGate: MergeGateResult
	replayArtifactPath: string
	governedArtifactPath: string
	replayChecksum?: string
	sealedAt: number
	sealed: boolean
	retryReason?: string
	integrity: ExecutionReplayIntegrityReport
	roadmapLinkage?: GovernedRoadmapLinkage
	auditIntegration?: GovernedAuditIntegration
	continuationDecision?: GovernedContinuationDecision
	executionPathMetrics?: GovernedExecutionPathMetrics
	/** Additive schema-v3 convergence package; optional only for historical receipts. */
	confidenceAwareConvergence?: ConfidenceAwareConvergenceResult
}

export function buildLaneId(swarmId: string, index: number): string {
	return `swarm-lane:${swarmId}:${index}`
}

export function buildMutexResourceKey(swarmId: string, index: number): string {
	return `governed-lane:${swarmId}:${index}`
}

export function buildRoadmapLeaseTaskId(swarmId: string, index: number): string {
	return `swarm-lane-${swarmId}-${index}`
}

export function buildOrchestrationLeaseTaskId(swarmId: string): string {
	return `governed-swarm-${swarmId}`
}

export interface GovernedOrchestrationLease {
	taskId: string
	acquired: boolean
	released: boolean
	expiresAt?: string
	unreleasedRisk?: boolean
	skipped?: boolean
}

export type RoadmapCompletionUpdatePolicy = "advisory_only" | "update_on_sealed_success"

export type RoadmapCompletionOutcomeStatus = "advisory_only" | "skipped" | "blocked" | "updated"

export interface RoadmapCompletionOutcome {
	policy: RoadmapCompletionUpdatePolicy
	status: RoadmapCompletionOutcomeStatus
	reason?: string
	remediationSteps?: string[]
}

export function lockClaimToHistoryEntry(
	claim: LockClaim,
	laneId: string,
	event: ClaimHistoryEvent,
	error?: string,
): ClaimHistoryEntry {
	return {
		claimId: claim.claimId,
		laneId,
		resourceKey: claim.resourceKey,
		ownerId: claim.ownerId,
		fencingToken: claim.fencingToken,
		lockBackends: claim.backends,
		event,
		timestamp: Date.now(),
		error,
	}
}

export function workLaneClaimFromLock(claim: LockClaim, swarmId: string, index: number, laneId: string): WorkLaneClaim {
	return {
		laneId,
		swarmId,
		agentId: claim.ownerId,
		index,
		roadmapLeaseTaskId: claim.roadmapLeaseTaskId || buildRoadmapLeaseTaskId(swarmId, index),
		claimedAt: claim.acquiredAt,
		lockClaim: claim,
		executionMode: "mutation",
		lockRequired: true,
		reasonLockAcquired: "governed lock acquired",
	}
}

export function workLaneClaimWithoutLock(
	swarmId: string,
	index: number,
	agentId: string,
	intent: {
		executionMode: LaneExecutionMode
		reasonLockSkipped: string
		readSet?: string[]
		writeSet?: string[]
		roadmapItemId?: string
		roadmapReadSet?: string[]
		roadmapWriteSet?: string[]
		roadmapMutationLockRequired?: boolean
		roadmapResourceKeys?: string[]
	},
): WorkLaneClaim {
	const laneId = buildLaneId(swarmId, index)
	return {
		laneId,
		swarmId,
		agentId,
		index,
		roadmapLeaseTaskId: buildRoadmapLeaseTaskId(swarmId, index),
		claimedAt: Date.now(),
		executionMode: intent.executionMode,
		lockRequired: false,
		lockSkipped: true,
		reasonLockSkipped: intent.reasonLockSkipped,
		readSet: intent.readSet,
		writeSet: intent.writeSet,
		roadmapItemId: intent.roadmapItemId,
		roadmapReadSet: intent.roadmapReadSet,
		roadmapWriteSet: intent.roadmapWriteSet,
		roadmapMutationLockRequired: intent.roadmapMutationLockRequired,
		roadmapResourceKeys: intent.roadmapResourceKeys,
	}
}

export function buildResourceOwners(claimHistory: ClaimHistoryEntry[]): GovernedResourceOwner[] {
	const active = new Map<string, GovernedResourceOwner>()

	for (const entry of claimHistory) {
		if (entry.event === "acquired" || entry.event === "recovered") {
			active.set(entry.resourceKey, {
				resourceKey: entry.resourceKey,
				ownerId: entry.ownerId,
				laneId: entry.laneId,
				claimId: entry.claimId,
				fencingToken: entry.fencingToken,
				lockBackends: entry.lockBackends,
				status: "active",
			})
		} else if (entry.event === "released") {
			active.set(entry.resourceKey, {
				resourceKey: entry.resourceKey,
				ownerId: entry.ownerId,
				laneId: entry.laneId,
				claimId: entry.claimId,
				fencingToken: entry.fencingToken,
				lockBackends: entry.lockBackends,
				status: "released",
			})
		} else if (entry.event === "stale_detected") {
			const existing = active.get(entry.resourceKey)
			if (existing) {
				existing.status = "stale"
			}
		}
	}

	return [...active.values()]
}

export function buildClaimTimeline(
	admission: GovernedAdmissionResult,
	claimHistory: ClaimHistoryEntry[],
	options?: { sealed?: boolean; audited?: boolean; mergeBlocked?: boolean; admittedAt?: number },
): GovernedClaimTimelineEntry[] {
	const timeline: GovernedClaimTimelineEntry[] = [
		{
			label: admission.admitted ? "admitted" : "rejected",
			event: admission.admitted ? "admitted" : "rejected",
			timestamp: options?.admittedAt ?? Date.now(),
			status: admission.admitted ? "ok" : "blocked",
		},
	]

	for (const entry of claimHistory) {
		const status: GovernedClaimTimelineEntry["status"] =
			entry.event === "rejected" || entry.event === "stale_detected" ? "failed" : "ok"
		timeline.push({
			label: entry.event,
			event: entry.event,
			timestamp: entry.timestamp,
			laneId: entry.laneId,
			claimId: entry.claimId,
			status,
		})
	}

	if (options?.audited) {
		timeline.push({ label: "audited", event: "audited", timestamp: Date.now(), status: "ok" })
	}
	if (options?.mergeBlocked) {
		timeline.push({ label: "merge_blocked", event: "merge_blocked", timestamp: Date.now(), status: "blocked" })
	}
	if (options?.sealed) {
		timeline.push({ label: "sealed", event: "sealed", timestamp: Date.now(), status: "ok" })
	}

	return timeline
}

export function deriveReceiptIncident(
	receipt: GovernedSwarmReceipt,
	options?: { corrupted?: boolean; inProgress?: boolean },
): GovernedReceiptIncident {
	if (options?.inProgress) {
		return "in_progress"
	}
	if (options?.corrupted) {
		return "corrupted_receipt"
	}
	if (!receipt.integrity.valid && receipt.replayChecksum) {
		return "replay_mismatch"
	}
	if (receipt.mergeGate.staleLeaseCount > 0) {
		return "stale_claim"
	}
	if (receipt.mergeGate.sealedSupersessionBlocked) {
		return "unsafe_retry"
	}
	if (receipt.sealed && receipt.mergeGate.passed) {
		return "sealed_success"
	}
	if (
		!receipt.sealed &&
		(receipt.laneReceipts.length === 0 ||
			receipt.laneDag.some((n) => n.state === "running") ||
			receipt.retryReason?.startsWith("crash:"))
	) {
		return "partial_receipt"
	}
	if (!receipt.sealed && receipt.laneReceipts.length > 0) {
		return "partial_receipt"
	}
	if (!receipt.mergeGate.passed) {
		return "merge_blocked"
	}
	if (receipt.mergeGate.violations.some((v) => v.includes("unavailable"))) {
		return "backend_unavailable"
	}
	return "failed_receipt"
}

export function isRetrySafe(
	receipt: GovernedSwarmReceipt,
	retryHistory?: GovernedRetryHistoryEntry[],
	resourceOwners: GovernedResourceOwner[] = buildResourceOwners(receipt.claimHistory),
): { safe: boolean; reason?: string } {
	const active = resourceOwners.filter((o) => o.status === "active")
	if (active.length > 0) {
		return { safe: false, reason: `Active claims remain: ${active.map((o) => o.resourceKey).join(", ")}` }
	}
	const stale = resourceOwners.filter((o) => o.status === "stale")
	if (stale.length > 0) {
		return { safe: false, reason: `Stale claims must be recovered first: ${stale.map((o) => o.resourceKey).join(", ")}` }
	}
	if (receipt.mergeGate.sealedSupersessionBlocked) {
		const lineageLinked =
			receipt.parentAttemptId &&
			retryHistory?.some((entry) => entry.sealed && entry.mergePassed && entry.attemptId === receipt.parentAttemptId)
		if (!lineageLinked) {
			return { safe: false, reason: "Prior sealed receipt would be superseded unsafely" }
		}
	}
	const priorSealed = retryHistory?.find((entry) => entry.sealed && entry.mergePassed && entry.attemptId !== receipt.attemptId)
	if (priorSealed && receipt.laneDag.some((n) => n.state === "running")) {
		return { safe: false, reason: "Lanes still running while prior attempt is sealed" }
	}
	return { safe: true }
}

export function buildReceiptDiagnostics(
	receipt: GovernedSwarmReceipt,
	retryHistory?: GovernedRetryHistoryEntry[],
	options?: { corrupted?: boolean; inProgress?: boolean; replayMismatchCauses?: string[] },
	resourceOwners: GovernedResourceOwner[] = buildResourceOwners(receipt.claimHistory),
): GovernedReceiptDiagnostics {
	const activeResourceOwners = resourceOwners.filter((o) => o.status === "active")
	const staleResourceOwners = resourceOwners.filter((o) => o.status === "stale")
	const overlappingPaths = receipt.mergeGate.mergeAudit.overlappingPaths
	const overlappingRoadmapResources = receipt.mergeGate.roadmapAudit?.overlappingResources ?? []
	const blockedRoadmapWriters = receipt.mergeGate.roadmapAudit?.blockedWriters ?? []
	const roadmapCompletionAdvisory =
		receipt.roadmapLinkage?.completionOutcome?.status === "advisory_only"
			? receipt.roadmapLinkage.completionOutcome.reason || receipt.roadmapLinkage.completionAdvisory
			: undefined
	const staleProjectionWarnings = receipt.roadmapLinkage?.patchReconciliation?.staleProjections
	const rebaseResults = receipt.roadmapLinkage?.patchReconciliation?.rebaseResults
	const rejectedPatchReasons = receipt.roadmapLinkage?.patchReconciliation?.rejectedPatches.map(
		(entry) => `${entry.patch.patchId.slice(0, 8)}: ${entry.reason}`,
	)
	const roadmapCommitStatus =
		receipt.roadmapLinkage?.workspaceCommit?.commitStatus ?? receipt.roadmapLinkage?.patchReconciliation?.commitStatus
	const missingTranscripts = receipt.laneReceipts
		.filter((lane) => lane.status === "completed" && !lane.transcriptArtifactPath)
		.map((lane) => lane.laneId)
	const missingToolEvidence = receipt.laneReceipts
		.filter((lane) => lane.status === "completed" && (lane.toolStepCount ?? 0) === 0 && lane.evidenceCount === 0)
		.map((lane) => lane.laneId)
	const incident = deriveReceiptIncident(receipt, options)
	const retry = isRetrySafe(receipt, retryHistory, resourceOwners)
	const authoritative =
		retryHistory?.find((entry) => entry.sealed && entry.mergePassed)?.attemptId ||
		(receipt.sealed && receipt.mergeGate.passed ? receipt.attemptId : undefined)

	const incidentSummary = (() => {
		switch (incident) {
			case "sealed_success":
				return "Swarm sealed successfully — merge gate passed."
			case "partial_receipt":
				return "Partial receipt — execution interrupted before seal."
			case "stale_claim":
				return "Stale ownership detected — recover before retry."
			case "unsafe_retry":
				return "Retry blocked — would supersede a sealed receipt."
			case "corrupted_receipt":
				return "Receipt artifact failed schema validation."
			case "replay_mismatch":
				return "Replay checksum does not match durable state."
			case "backend_unavailable":
				return "Durable lock backend unavailable during claim."
			case "merge_blocked":
				return receipt.mergeGate.violations[0] || "Merge gate blocked."
			case "in_progress":
				return "Swarm still executing — receipt not final."
			default:
				return receipt.mergeGate.violations[0] || "Swarm failed — see violations."
		}
	})()

	return {
		incident,
		incidentSummary,
		retrySafe: retry.safe,
		retryUnsafeReason: retry.reason,
		authoritativeAttemptId: authoritative,
		governanceWarnings: receipt.auditIntegration?.governanceDiagnostics?.map((d) => d.code),
		activeResourceOwners,
		staleResourceOwners,
		overlappingPaths,
		overlappingRoadmapResources,
		blockedRoadmapWriters,
		roadmapCompletionAdvisory,
		workspaceRoadmapSnapshotId: receipt.roadmapLinkage?.workspaceRoadmapSnapshotId,
		staleProjectionWarnings,
		rebaseResults,
		rejectedPatchReasons,
		roadmapCommitStatus,
		missingTranscripts,
		missingToolEvidence,
		replayMismatchCauses: options?.replayMismatchCauses ?? receipt.integrity.violations,
		advisoryWarnings: receipt.mergeGate.advisoryWarnings ?? [],
		retryDisposition: receipt.mergeGate.retryDisposition,
		convergenceDiagnostics: receipt.confidenceAwareConvergence?.diagnostics,
	}
}

export function buildGovernedReceiptSummary(
	receipt: GovernedSwarmReceipt,
	retryHistory?: GovernedRetryHistoryEntry[],
	normalizedResourceOwners?: GovernedResourceOwner[],
	metrics?: GovernedExecutionPathMetrics,
): GovernedReceiptSummary {
	const collisionRejections = receipt.laneReceipts.filter((lane) => lane.status === "collision_rejected").length
	const lanesFailed = receipt.laneReceipts.filter((lane) => lane.status === "failed").length
	const lanesSealed = receipt.laneDag.filter((lane) => lane.state === "sealed").length
	const lanesBlocked = receipt.laneDag.filter((lane) => lane.state === "blocked").length
	const lanesRunning = receipt.laneDag.filter((lane) => lane.state === "running").length
	const evidenceComplete = receipt.laneReceipts.every(
		(lane) => lane.status !== "completed" || (lane.evidenceCount > 0 && !lane.placeholderWarnings?.length),
	)
	if (!normalizedResourceOwners && metrics) {
		metrics.claimReconstructions++
	}
	const resourceOwners = normalizedResourceOwners ?? buildResourceOwners(receipt.claimHistory)

	return {
		swarmId: receipt.swarmId,
		attemptId: receipt.attemptId,
		parentAttemptId: receipt.parentAttemptId,
		admitted: receipt.admission.admitted,
		admissionReason: receipt.admission.reason,
		mergePassed: receipt.mergeGate.passed,
		sealed: receipt.sealed,
		laneCount: receipt.laneReceipts.length,
		lanesSealed,
		lanesFailed,
		lanesBlocked,
		lanesRunning,
		collisionRejections,
		orphanedClaims: receipt.mergeGate.orphanedClaimCount,
		integrityValid: receipt.integrity.valid,
		evidenceComplete,
		replayChecksum: receipt.replayChecksum,
		replayIntegrityValid: receipt.mergeGate.replayIntegrity.valid,
		splitBrainDetected: receipt.mergeGate.splitBrainDetected,
		governedArtifactPath: receipt.governedArtifactPath,
		replayArtifactPath: receipt.replayArtifactPath,
		violations: receipt.mergeGate.violations,
		advisoryWarnings: receipt.mergeGate.advisoryWarnings ?? [],
		retryDisposition: receipt.mergeGate.retryDisposition,
		continuationDecision: receipt.continuationDecision,
		executionPathMetrics: receipt.executionPathMetrics,
		confidenceAwareConvergence: receipt.confidenceAwareConvergence,
		laneStates: receipt.laneReceipts.map((lane) => ({
			index: lane.index,
			laneId: lane.laneId,
			status: lane.status,
			executionValidity: lane.executionValidity,
			findingConfidence: lane.findingConfidence,
			confidenceReason: lane.confidenceReason,
			dagState: lane.dagState,
			claimId: lane.claimId,
			evidenceCount: lane.evidenceCount,
			executionMode: lane.executionMode,
			lockRequired: lane.lockRequired,
			reasonLockSkipped: lane.reasonLockSkipped,
			reasonLockAcquired: lane.reasonLockAcquired,
			readSet: lane.readSet,
			writeSet: lane.writeSet,
			roadmapReadSet: lane.roadmapReadSet,
			roadmapWriteSet: lane.roadmapWriteSet,
			roadmapMutationLockRequired: lane.roadmapMutationLockRequired,
			roadmapMutationClaimReleased: lane.roadmapMutationClaimReleased,
			roadmapResourceKeys: lane.roadmapResourceKeys,
			roadmapItemOwner: lane.roadmapItemOwner,
			reasonRoadmapLockAcquired: lane.reasonRoadmapLockAcquired,
			agentRoadmapId: lane.agentRoadmapId,
			roadmapSnapshotId: lane.roadmapSnapshotId,
			projectedItems: lane.projectedItems,
			localRoadmapEvents: lane.localRoadmapEvents,
			proposedWorkspacePatch: lane.proposedWorkspacePatch,
		})),
		laneDag: receipt.laneDag,
		claimTimeline: buildClaimTimeline(receipt.admission, receipt.claimHistory, {
			sealed: receipt.sealed,
			audited: true,
			mergeBlocked: !receipt.mergeGate.passed,
		}),
		resourceOwners,
		retryHistory: retryHistory ?? [],
		diagnostics: buildReceiptDiagnostics(receipt, retryHistory, undefined, resourceOwners),
		roadmapLinkage: receipt.roadmapLinkage,
	}
}
