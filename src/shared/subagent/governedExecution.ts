import type { ExecutionReplayIntegrityReport } from "@shared/execution/replayContract"
import type { LockBackends, LockClaim } from "@/core/governance/LockAuthority"

export const GOVERNED_RECEIPT_SCHEMA_VERSION = 3 as const

export type LaneDAGState = "ready" | "blocked" | "running" | "sealed" | "failed"

export interface LaneDAGNode {
	index: number
	laneId: string
	dependsOn: number[]
	state: LaneDAGState
	agentId?: string
	error?: string
}

export interface GovernedAdmissionResult {
	admitted: boolean
	backoffMs: number
	pressureScore?: number
	reason?: string
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
}

export type LaneExecutionStatus = "completed" | "failed" | "skipped" | "collision_rejected" | "blocked" | "running"

export interface LaneExecutionReceipt {
	laneId: string
	agentId: string
	index: number
	status: LaneExecutionStatus
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
	releasedAt?: number
	fencingToken?: number
	lockBackends?: LockBackends
	placeholderWarnings?: string[]
	auditResult?: "passed" | "failed"
	replayChecksum?: string
	error?: string
}

export type ClaimHistoryEvent = "acquired" | "released" | "rejected" | "stale_detected" | "recovered"

export interface ClaimHistoryEntry {
	claimId?: string
	laneId: string
	resourceKey: string
	ownerId: string
	fencingToken: number
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

export interface MergeSafetyAudit {
	safe: boolean
	violations: string[]
	overlappingPaths: MergePathOverlap[]
	missingEvidence: string[]
	placeholderWarnings: string[]
}

export interface MergeGateResult {
	passed: boolean
	mergeAudit: MergeSafetyAudit
	replayIntegrity: ExecutionReplayIntegrityReport
	violations: string[]
	failedLaneCount: number
	orphanedClaimCount: number
	staleLeaseCount: number
	splitBrainDetected: boolean
	sealedSupersessionBlocked: boolean
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
	claimId?: string
	fencingToken: number
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
	missingTranscripts: string[]
	missingToolEvidence: string[]
	replayMismatchCauses: string[]
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
	laneStates: Array<{
		index: number
		laneId: string
		status: LaneExecutionStatus
		dagState?: LaneDAGState
		claimId?: string
		evidenceCount?: number
	}>
	laneDag: LaneDAGNode[]
	claimTimeline: GovernedClaimTimelineEntry[]
	resourceOwners: GovernedResourceOwner[]
	retryHistory: GovernedRetryHistoryEntry[]
	diagnostics: GovernedReceiptDiagnostics
}

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
	if (receipt.mergeGate.staleLeaseCount > 0 || receipt.claimHistory.some((e) => e.event === "stale_detected")) {
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
): { safe: boolean; reason?: string } {
	const resourceOwners = buildResourceOwners(receipt.claimHistory)
	const active = resourceOwners.filter((o) => o.status === "active")
	if (active.length > 0) {
		return { safe: false, reason: `Active claims remain: ${active.map((o) => o.resourceKey).join(", ")}` }
	}
	const stale = resourceOwners.filter((o) => o.status === "stale")
	if (stale.length > 0) {
		return { safe: false, reason: `Stale claims must be recovered first: ${stale.map((o) => o.resourceKey).join(", ")}` }
	}
	if (receipt.mergeGate.sealedSupersessionBlocked) {
		return { safe: false, reason: "Prior sealed receipt would be superseded unsafely" }
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
): GovernedReceiptDiagnostics {
	const resourceOwners = buildResourceOwners(receipt.claimHistory)
	const activeResourceOwners = resourceOwners.filter((o) => o.status === "active")
	const staleResourceOwners = resourceOwners.filter((o) => o.status === "stale")
	const overlappingPaths = receipt.mergeGate.mergeAudit.overlappingPaths
	const missingTranscripts = receipt.laneReceipts
		.filter((lane) => lane.status === "completed" && !lane.transcriptArtifactPath)
		.map((lane) => lane.laneId)
	const missingToolEvidence = receipt.laneReceipts
		.filter((lane) => lane.status === "completed" && (lane.toolStepCount ?? 0) === 0 && lane.evidenceCount === 0)
		.map((lane) => lane.laneId)
	const incident = deriveReceiptIncident(receipt, options)
	const retry = isRetrySafe(receipt, retryHistory)
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
		activeResourceOwners,
		staleResourceOwners,
		overlappingPaths,
		missingTranscripts,
		missingToolEvidence,
		replayMismatchCauses: options?.replayMismatchCauses ?? receipt.integrity.violations,
	}
}

export function buildGovernedReceiptSummary(
	receipt: GovernedSwarmReceipt,
	retryHistory?: GovernedRetryHistoryEntry[],
): GovernedReceiptSummary {
	const collisionRejections = receipt.laneReceipts.filter((lane) => lane.status === "collision_rejected").length
	const lanesFailed = receipt.laneReceipts.filter((lane) => lane.status === "failed").length
	const lanesSealed = receipt.laneDag.filter((lane) => lane.state === "sealed").length
	const lanesBlocked = receipt.laneDag.filter((lane) => lane.state === "blocked").length
	const lanesRunning = receipt.laneDag.filter((lane) => lane.state === "running").length
	const evidenceComplete = receipt.laneReceipts.every(
		(lane) => lane.status !== "completed" || (lane.evidenceCount > 0 && !lane.placeholderWarnings?.length),
	)

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
		laneStates: receipt.laneReceipts.map((lane) => ({
			index: lane.index,
			laneId: lane.laneId,
			status: lane.status,
			dagState: lane.dagState,
			claimId: lane.claimId,
			evidenceCount: lane.evidenceCount,
		})),
		laneDag: receipt.laneDag,
		claimTimeline: buildClaimTimeline(receipt.admission, receipt.claimHistory, {
			sealed: receipt.sealed,
			audited: true,
			mergeBlocked: !receipt.mergeGate.passed,
		}),
		resourceOwners: buildResourceOwners(receipt.claimHistory),
		retryHistory: retryHistory ?? [],
		diagnostics: buildReceiptDiagnostics(receipt, retryHistory),
	}
}
