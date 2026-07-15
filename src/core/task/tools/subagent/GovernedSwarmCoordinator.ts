import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	ConfidenceProbeHistoryEntry,
	GovernedAdmissionResult,
	GovernedCrashPhase,
	GovernedExecutionPathMetrics,
	GovernedOrchestrationLease,
	GovernedReceiptSummary,
	GovernedResourceOwner,
	GovernedRetryHistoryEntry,
	GovernedSwarmReceipt,
	LaneExecutionMode,
	LaneExecutionReceipt,
	LaneExecutionStatus,
	RoadmapCompletionUpdatePolicy,
	WorkLaneClaim,
} from "@shared/subagent/governedExecution"
import {
	buildClaimTimeline,
	buildGovernedReceiptSummary,
	buildLaneId,
	buildMutexResourceKey,
	buildOrchestrationLeaseTaskId,
	buildReceiptDiagnostics,
	buildResourceOwners,
	buildRoadmapLeaseTaskId,
	GOVERNED_RECEIPT_SCHEMA_VERSION,
	lockClaimToHistoryEntry,
	workLaneClaimFromLock,
	workLaneClaimWithoutLock,
} from "@shared/subagent/governedExecution"
import { v4 as uuidv4 } from "uuid"
import type { LockAuthority } from "@/core/governance/LockAuthority"
import { createLockAuthority, releaseGovernedLock } from "@/core/governance/LockAuthority"
import type { GatePreflightReadinessIssue } from "@/core/task/tools/completionGatePipeline"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import {
	agentAttemptedDirectWorkspaceRoadmapMutation,
	buildAgentRoadmapProjection,
	buildSwarmRoadmapPlan,
	collectKnownRoadmapItemIds,
	collectRoadmapLaneArtifacts,
	computeRoadmapSnapshotId,
} from "./AgentRoadmapProjection"
import { evaluateConfidenceAwareConvergence } from "./ConfidenceAwareConvergence"
import {
	buildCoordinatorContinuationContext,
	classifyPreflightIssuesForSeal,
	evaluateCoordinatorHaltDecision,
	mergeGovernanceDiagnostics,
	reduceGovernedContinuation,
	resolvePriorSealedReceiptForMerge,
} from "./CoordinatorExecutionAuthority"
import { swarmEnvelopeToReplayArtifact } from "./executionReplayMappers"
import type { SwarmValidationSnapshot } from "./executionValidation"
import {
	buildGovernedArtifactRelativePath,
	listGovernedReceiptHistory,
	loadSealReceiptContext,
	persistGovernedReceipt,
} from "./GovernedExecutionStore"
import { applyGovernedRoadmapCompletionPolicy, buildGovernedAuditIntegration, captureRoadmapLinkage } from "./GovernedIntegration"
import { LaneDAG } from "./LaneDAG"
import { classifyLockNecessity, type LaneLockIntent, splitReadWriteSets } from "./LockNecessity"
import { runMergeGate } from "./MergeGate"
import { explainReplayMismatch, validateDeterministicReplay } from "./ReplayValidator"
import { auditRoadmapCompletionIntegrity, auditStaleRoadmapOrchestrationLease } from "./RoadmapMergeAudit"
import { splitRoadmapReadWriteSets } from "./RoadmapMutation"
import { auditDirectWorkspaceRoadmapMutation, runRoadmapPatchReconciliation } from "./RoadmapPatchReconciler"
import { commitWorkspaceRoadmapPatches } from "./RoadmapWorkspaceCommit"

export type { GovernedCrashPhase } from "@shared/subagent/governedExecution"

const LANE_LEASE_SECONDS = 600
const ORCHESTRATION_LEASE_SECONDS = 1200
const LANE_MUTEX_MS = LANE_LEASE_SECONDS * 1000

export class GovernedSwarmCoordinator {
	private readonly lockAuthority: LockAuthority
	private readonly laneDag: LaneDAG
	private readonly claimHistory: ClaimHistoryEntry[] = []
	private readonly attemptId: string
	private orchestrationLease?: {
		taskId: string
		ownerId: string
		acquired: boolean
		released: boolean
		expiresAt?: string
	}
	private workspaceRoadmapSnapshotId?: string
	private swarmRoadmapPlan?: import("@shared/subagent/roadmapProjection").SwarmRoadmapPlan
	private receiptHistoryCache?: GovernedRetryHistoryEntry[]
	private normalizedResourceOwners?: GovernedResourceOwner[]

	constructor(
		private readonly workspace: string,
		private readonly roadmapEnabled: boolean,
		laneCount: number,
		dependencies?: Map<number, number[]>,
		lockAuthority?: LockAuthority,
		attemptId?: string,
		private readonly parentAttemptId?: string,
		private readonly executionPathMetrics?: GovernedExecutionPathMetrics,
	) {
		this.lockAuthority = lockAuthority ?? createLockAuthority()
		this.laneDag = new LaneDAG(laneCount, dependencies)
		this.attemptId = attemptId ?? uuidv4()
	}

	getAttemptId(): string {
		return this.attemptId
	}

	getLaneDAG() {
		return this.laneDag
	}

	getClaimHistory(): ClaimHistoryEntry[] {
		return [...this.claimHistory]
	}

	async admitSwarm(parentAgentId: string, operation = "subagent_swarm"): Promise<GovernedAdmissionResult> {
		await this.lockAuthority.recoverStale(this.workspace, "governed-lane:")

		if (!this.roadmapEnabled) {
			return { admitted: true, backoffMs: 0, reason: "roadmap_disabled", operation, roadmapEnabled: false }
		}

		const admission = await RoadmapService.getInstance().scheduleAdmission(this.workspace, parentAgentId, operation)
		if (!admission.admitted) {
			return {
				admitted: false,
				backoffMs: admission.backoff_ms,
				pressureScore: admission.pressure_score,
				reason: "roadmap_pressure",
				operation,
				roadmapEnabled: true,
			}
		}

		return {
			admitted: true,
			backoffMs: 0,
			pressureScore: admission.pressure_score,
			operation,
			roadmapEnabled: true,
		}
	}

	private async ensureWorkspaceRoadmapSnapshot(swarmId: string): Promise<void> {
		if (!this.roadmapEnabled || this.workspaceRoadmapSnapshotId) {
			return
		}
		const state = await RoadmapService.getInstance().getOrHydrateRuntimeState(this.workspace)
		this.workspaceRoadmapSnapshotId = computeRoadmapSnapshotId(state)
		this.swarmRoadmapPlan = buildSwarmRoadmapPlan(swarmId, this.workspaceRoadmapSnapshotId, [])
	}

	private async attachAgentRoadmapProjection(
		swarmId: string,
		claim: WorkLaneClaim,
		intent: LaneLockIntent,
		index: number,
		agentId: string,
	): Promise<void> {
		if (!this.roadmapEnabled || !this.workspaceRoadmapSnapshotId) {
			return
		}
		const state = await RoadmapService.getInstance().getOrHydrateRuntimeState(this.workspace)
		const node = this.laneDag.getNode(index)
		claim.agentRoadmap = buildAgentRoadmapProjection({
			swarmId,
			laneId: claim.laneId,
			agentId,
			index,
			workspaceSnapshotId: this.workspaceRoadmapSnapshotId,
			swarmRoadmapId: this.swarmRoadmapPlan?.swarmRoadmapId ?? `swarm-rm:${swarmId}`,
			intent,
			workspaceState: state,
			dependsOn: node?.dependsOn ?? [],
		})
	}

	async acquireSwarmOrchestrationLease(
		swarmId: string,
		parentAgentId: string,
	): Promise<{ acquired: boolean; skipped?: boolean; expiresAt?: string; error?: string }> {
		if (!this.roadmapEnabled) {
			return { acquired: true, skipped: true }
		}

		const taskId = buildOrchestrationLeaseTaskId(swarmId)
		const result = await RoadmapService.getInstance().acquireOrchestrationLease(
			this.workspace,
			parentAgentId,
			taskId,
			ORCHESTRATION_LEASE_SECONDS,
		)

		if (!result.success) {
			return { acquired: false, error: "orchestration lease denied" }
		}

		this.orchestrationLease = {
			taskId,
			ownerId: parentAgentId,
			acquired: true,
			released: false,
			expiresAt: result.expires_at,
		}
		if (this.executionPathMetrics) {
			this.executionPathMetrics.lockAcquisitions++
		}

		return { acquired: true, expiresAt: result.expires_at }
	}

	async releaseSwarmOrchestrationLease(): Promise<{ released: boolean; unreleasedRisk?: boolean }> {
		if (!this.orchestrationLease?.acquired || this.orchestrationLease.released) {
			return { released: true }
		}
		if (!this.roadmapEnabled) {
			this.orchestrationLease.released = true
			return { released: true }
		}

		await RoadmapService.getInstance().releaseOrchestrationLease(
			this.workspace,
			this.orchestrationLease.ownerId,
			this.orchestrationLease.taskId,
		)
		this.orchestrationLease.released = true
		return { released: true }
	}

	getOrchestrationLeaseSnapshot(): GovernedOrchestrationLease | undefined {
		if (!this.orchestrationLease) {
			return undefined
		}
		return {
			taskId: this.orchestrationLease.taskId,
			acquired: this.orchestrationLease.acquired,
			released: this.orchestrationLease.released,
			expiresAt: this.orchestrationLease.expiresAt,
			unreleasedRisk: this.orchestrationLease.acquired && !this.orchestrationLease.released,
		}
	}

	isLaneReady(index: number): boolean {
		const node = this.laneDag.getNode(index)
		return node?.state === "ready"
	}

	async acquireLane(
		swarmId: string,
		agentId: string,
		index: number,
		intent?: LaneLockIntent,
	): Promise<{ success: boolean; claim?: WorkLaneClaim; error?: string; lockSkipped?: boolean }> {
		const laneId = buildLaneId(swarmId, index)
		const node = this.laneDag.getNode(index)
		const resolvedIntent: LaneLockIntent = intent ?? { executionMode: "mutation" }
		const necessity = classifyLockNecessity(resolvedIntent)

		if (node?.state === "sealed") {
			return { success: false, error: `Lane ${index} already sealed.` }
		}
		if (node?.state === "blocked") {
			return { success: false, error: `Lane ${index} blocked by dependencies.` }
		}
		if (node?.state === "running" && node.agentId && node.agentId !== agentId) {
			return {
				success: false,
				error: `Lane '${laneId}' already claimed by agent '${node.agentId}'.`,
			}
		}

		const isRetryReentry = node?.state === "running" && node.agentId === agentId

		await this.ensureWorkspaceRoadmapSnapshot(swarmId)

		let claim: WorkLaneClaim | undefined
		let lockSkipped = false

		if (!necessity.lockRequired) {
			lockSkipped = true
			claim = workLaneClaimWithoutLock(swarmId, index, agentId, {
				executionMode: resolvedIntent.executionMode,
				reasonLockSkipped: necessity.reasonLockSkipped || "lock not required",
				readSet: resolvedIntent.readSet,
				writeSet: resolvedIntent.writeSet,
				roadmapItemId: resolvedIntent.roadmapItemId,
				roadmapReadSet: resolvedIntent.roadmapReadSet,
				roadmapWriteSet: resolvedIntent.roadmapWriteSet,
				roadmapMutationLockRequired: false,
				roadmapResourceKeys: resolvedIntent.roadmapResourceKeys,
			})
		} else {
			const resourceKey = buildMutexResourceKey(swarmId, index)
			const leaseTaskId = buildRoadmapLeaseTaskId(swarmId, index)

			const result = await this.lockAuthority.acquire(resourceKey, agentId, {
				workspace: this.workspace,
				roadmapLeaseTaskId: leaseTaskId,
				timeoutMs: LANE_MUTEX_MS,
				roadmapEnabled: this.roadmapEnabled,
				crossProcess: true,
				requireDurability: true,
			})

			if (!result.ok) {
				this.claimHistory.push({
					laneId,
					resourceKey,
					ownerId: agentId,
					fencingToken: 0,
					event: "rejected",
					timestamp: Date.now(),
					error: result.error,
				})
				return { success: false, error: result.error }
			}
			if (this.executionPathMetrics) {
				this.executionPathMetrics.lockAcquisitions++
			}

			const verify = await this.lockAuthority.verify(result.claim, this.workspace)
			if (!verify.valid) {
				const releaseResult = await releaseGovernedLock(this.lockAuthority, result.claim, this.workspace)
				this.claimHistory.push(
					lockClaimToHistoryEntry(
						result.claim,
						laneId,
						verify.reason === "stale_owner" ? "stale_detected" : "rejected",
						verify.reason,
					),
				)
				if (releaseResult.ok) {
					this.claimHistory.push(lockClaimToHistoryEntry(result.claim, laneId, "released"))
				} else {
					this.claimHistory.push(lockClaimToHistoryEntry(result.claim, laneId, "rejected", releaseResult.error))
				}
				return { success: false, error: `Claim verification failed (${verify.reason}).` }
			}

			this.claimHistory.push(lockClaimToHistoryEntry(result.claim, laneId, "acquired"))
			claim = workLaneClaimFromLock(result.claim, swarmId, index, laneId)
			claim.executionMode = resolvedIntent.executionMode
			claim.lockRequired = true
			claim.reasonLockAcquired = necessity.reasonLockAcquired
		}

		await this.attachAgentRoadmapProjection(swarmId, claim, resolvedIntent, index, agentId)
		claim.roadmapMutationLockRequired = false
		claim.readSet = resolvedIntent.readSet
		claim.writeSet = resolvedIntent.writeSet
		claim.roadmapItemId = resolvedIntent.roadmapItemId
		claim.roadmapReadSet = resolvedIntent.roadmapReadSet
		claim.roadmapWriteSet = resolvedIntent.roadmapWriteSet

		if (!isRetryReentry) {
			this.laneDag.markRunning(index, agentId, resolvedIntent.executionMode)
		}
		if (lockSkipped) {
			return { success: true, lockSkipped: true, claim }
		}
		return { success: true, claim }
	}

	/** Release governed locks without changing DAG state — used during retry backoff. */
	async releaseLaneLocks(claim: WorkLaneClaim): Promise<void> {
		await this.releaseLockClaims(claim)
		claim.lockClaim = undefined
		claim.roadmapLockClaims = undefined
	}

	async releaseLane(claim: WorkLaneClaim, sealed: boolean, failed = false, error?: string): Promise<void> {
		await this.releaseLockClaims(claim)

		if (sealed) {
			this.laneDag.markSealed(claim.index)
		} else if (failed) {
			this.laneDag.markFailed(claim.index, error)
		}
	}

	private async releaseLockClaims(claim: WorkLaneClaim): Promise<void> {
		if (claim.roadmapLockClaims?.length) {
			for (const roadmapClaim of claim.roadmapLockClaims) {
				const verify = await this.lockAuthority.verify(roadmapClaim, this.workspace)
				if (!verify.valid && verify.reason === "stale_owner") {
					this.claimHistory.push(lockClaimToHistoryEntry(roadmapClaim, claim.laneId, "stale_detected", verify.reason))
				}
				const releaseResult = await releaseGovernedLock(this.lockAuthority, roadmapClaim, this.workspace)
				if (!releaseResult.ok) {
					this.claimHistory.push(lockClaimToHistoryEntry(roadmapClaim, claim.laneId, "rejected", releaseResult.error))
				} else {
					this.claimHistory.push(lockClaimToHistoryEntry(roadmapClaim, claim.laneId, "released"))
				}
			}
		}

		if (claim.lockClaim) {
			const verify = await this.lockAuthority.verify(claim.lockClaim, this.workspace)
			if (!verify.valid && verify.reason === "stale_owner") {
				this.claimHistory.push(lockClaimToHistoryEntry(claim.lockClaim, claim.laneId, "stale_detected", verify.reason))
			}
			const releaseResult = await releaseGovernedLock(this.lockAuthority, claim.lockClaim, this.workspace)
			if (!releaseResult.ok) {
				this.claimHistory.push(lockClaimToHistoryEntry(claim.lockClaim, claim.laneId, "rejected", releaseResult.error))
			} else {
				this.claimHistory.push(lockClaimToHistoryEntry(claim.lockClaim, claim.laneId, "released"))
			}
		}
	}

	markLaneSkipped(index: number): void {
		this.laneDag.markSealed(index)
	}

	buildLaneReceipt(
		claim: WorkLaneClaim,
		envelope: SubagentExecutionEnvelope | undefined,
		status: LaneExecutionStatus,
		claimReleased: boolean,
		error?: string,
	): LaneExecutionReceipt {
		const dagNode = this.laneDag.getNode(claim.index)
		const placeholderWarnings: string[] = []
		const placeholderPattern = /\b(TODO|FIXME|PLACEHOLDER|TBD)\b/i
		if (envelope?.verbatimOutput && placeholderPattern.test(envelope.verbatimOutput)) {
			placeholderWarnings.push(envelope.agentId)
		}

		const { readSet, writeSet } = splitReadWriteSets(
			claim.executionMode,
			claim.lockRequired,
			envelope?.touchedFiles,
			envelope?.toolSteps,
			claim.readSet,
			claim.writeSet,
		)
		const { roadmapReadSet, roadmapWriteSet } = splitRoadmapReadWriteSets({
			intentReadSet: claim.roadmapReadSet,
			intentWriteSet: claim.roadmapWriteSet,
			toolSteps: envelope?.toolSteps,
		})
		const { localRoadmapEvents, proposedWorkspacePatch, localEventRejections } = collectRoadmapLaneArtifacts({
			prompt: envelope?.prompt,
			projection: claim.agentRoadmap,
			toolSteps: envelope?.toolSteps,
			evidencePointer: envelope?.transcriptArtifactPath,
			evidenceCount: envelope?.evidenceRefs.length ?? 0,
		})
		const directWorkspaceRoadmapMutation = agentAttemptedDirectWorkspaceRoadmapMutation({
			toolSteps: envelope?.toolSteps,
			proposedPatches: proposedWorkspacePatch,
		})
		const roadmapMutationClaimReleased = claim.roadmapMutationLockRequired ? claimReleased : true

		const emptyBackends = {
			inProcess: false,
			swarmMutex: false,
			roadmapLease: false,
			fileLock: false,
			broccoliFence: false,
		}

		const receipt: LaneExecutionReceipt = {
			laneId: claim.laneId,
			agentId: claim.agentId,
			index: claim.index,
			status,
			executionValidity:
				envelope?.executionValidity ?? (status === "completed" || status === "skipped" ? "valid" : "invalid"),
			findingConfidence: envelope?.confidence ?? "unknown",
			confidenceReason:
				envelope?.structuredFindings.find((finding) => finding.source === "verbatim")?.confidenceReason ??
				(envelope?.confidence === "high" ? "direct_evidence" : "model_uncertainty"),
			dagState: dagNode?.state,
			attemptId: this.attemptId,
			claimId: claim.lockRequired ? claim.lockClaim?.claimId : undefined,
			claimReleased: claim.lockRequired ? claimReleased : true,
			evidenceCount: envelope?.evidenceRefs.length ?? 0,
			touchedFiles: envelope?.touchedFiles ?? [],
			transcriptArtifactPath: envelope?.transcriptArtifactPath,
			toolStepCount: envelope?.toolSteps.length ?? 0,
			sealedAt: Date.now(),
			acquiredAt: claim.lockClaim?.acquiredAt,
			releasedAt: claim.lockClaim?.releasedAt,
			fencingToken: claim.lockRequired ? claim.lockClaim?.fencingToken : undefined,
			lockBackends: claim.lockRequired ? claim.lockClaim?.backends : emptyBackends,
			placeholderWarnings: placeholderWarnings.length ? placeholderWarnings : undefined,
			auditResult:
				status === "completed" && (claim.lockRequired ? claimReleased : true) && !placeholderWarnings.length
					? "passed"
					: "failed",
			error,
			executionMode: claim.executionMode,
			lockRequired: claim.lockRequired,
			reasonLockSkipped: claim.reasonLockSkipped,
			reasonLockAcquired: claim.reasonLockAcquired,
			readSet,
			writeSet,
			roadmapLeaseTaskId: claim.roadmapLeaseTaskId,
			roadmapItemId: claim.roadmapItemId,
			completionAuditPhase: envelope?.phase,
			roadmapReadSet: roadmapReadSet.length ? roadmapReadSet : undefined,
			roadmapWriteSet: roadmapWriteSet.length ? roadmapWriteSet : undefined,
			roadmapMutationLockRequired: claim.roadmapMutationLockRequired,
			roadmapMutationClaimReleased,
			roadmapResourceKeys: claim.roadmapResourceKeys,
			roadmapItemOwner: claim.roadmapMutationLockRequired && !roadmapMutationClaimReleased ? claim.agentId : undefined,
			reasonRoadmapLockAcquired: claim.reasonRoadmapLockAcquired,
			agentRoadmapId: claim.agentRoadmap?.agentRoadmapId,
			roadmapSnapshotId: claim.agentRoadmap?.roadmapSnapshotId,
			projectedItems: claim.agentRoadmap?.projectedItems,
			localRoadmapEvents: localRoadmapEvents.length ? localRoadmapEvents : undefined,
			proposedWorkspacePatch: proposedWorkspacePatch.length ? proposedWorkspacePatch : undefined,
			directWorkspaceRoadmapMutation,
			localEventContainmentViolations: localEventRejections.length ? localEventRejections : undefined,
		}

		return receipt
	}

	private async finalizeRoadmapSealState(options: {
		swarmId: string
		admission: GovernedAdmissionResult
		laneReceipts: LaneExecutionReceipt[]
		completionPolicy: RoadmapCompletionUpdatePolicy
		sealed: boolean
		mergePassed: boolean
		integrityValid: boolean
		replayMismatch: boolean
		unsafeRetry: boolean
		releaseLease: boolean
		patchReconciliation?: import("@shared/subagent/roadmapProjection").RoadmapPatchReconciliation
		workspaceCommit?: import("@shared/subagent/roadmapProjection").RoadmapWorkspaceCommitResult
	}) {
		if (options.releaseLease) {
			await this.releaseSwarmOrchestrationLease()
		}

		const completionOutcome = await applyGovernedRoadmapCompletionPolicy({
			workspace: this.workspace,
			policy: options.completionPolicy,
			sealed: options.sealed,
			mergePassed: options.mergePassed,
			integrityValid: options.integrityValid,
			replayMismatch: options.replayMismatch,
			unsafeRetry: options.unsafeRetry,
		})

		if (this.swarmRoadmapPlan && options.laneReceipts.length) {
			this.swarmRoadmapPlan = buildSwarmRoadmapPlan(
				options.swarmId,
				this.workspaceRoadmapSnapshotId ?? this.swarmRoadmapPlan.roadmapSnapshotId,
				options.laneReceipts.map((lane) => ({
					index: lane.index,
					laneId: lane.laneId,
					roadmapItemId: lane.roadmapItemId,
				})),
			)
		}

		return captureRoadmapLinkage(this.workspace, options.swarmId, options.admission, options.laneReceipts, {
			orchestrationLease: this.getOrchestrationLeaseSnapshot(),
			completionPolicy: options.completionPolicy,
			completionOutcome,
			workspaceRoadmapSnapshotId: this.workspaceRoadmapSnapshotId,
			swarmRoadmapPlan: this.swarmRoadmapPlan,
			patchReconciliation: options.patchReconciliation,
			workspaceCommit: options.workspaceCommit,
		})
	}

	async sealReceipt(options: {
		taskId: string
		envelope: SwarmExecutionEnvelope
		admission: GovernedAdmissionResult
		laneReceipts: LaneExecutionReceipt[]
		replayArtifact?: ExecutionReplayArtifact
		forceFail?: boolean
		retryReason?: string
		preflightIssues?: GatePreflightReadinessIssue[]
		completionPolicy?: RoadmapCompletionUpdatePolicy
		validationSnapshot?: SwarmValidationSnapshot
		recoveryActive?: boolean
		probeHistory?: ConfidenceProbeHistoryEntry[]
	}): Promise<GovernedSwarmReceipt> {
		const replayArtifact = options.replayArtifact || swarmEnvelopeToReplayArtifact(options.envelope)
		if (this.executionPathMetrics) {
			this.executionPathMetrics.receiptContextReads++
			this.executionPathMetrics.receiptHistoryReads++
		}
		const sealContext = await loadSealReceiptContext(options.taskId, options.envelope.swarmId)
		this.receiptHistoryCache = sealContext.history
		const latestPointerReceipt = sealContext.latestPointer
		const authoritativeReceipt = sealContext.authoritative
		const { prior: priorSealedReceipt, diagnostics: priorReceiptDiagnostics } = resolvePriorSealedReceiptForMerge(
			authoritativeReceipt,
			latestPointerReceipt,
		)
		const { advisory: sealPreflightIssues, diagnostics: preflightDiagnostics } = classifyPreflightIssuesForSeal(
			options.preflightIssues ?? [],
		)
		let governanceDiagnostics = mergeGovernanceDiagnostics(undefined, [...priorReceiptDiagnostics, ...preflightDiagnostics])

		const { normalizedResourceOwners, ...mergeGate } = runMergeGate({
			agents: options.envelope.agents,
			laneReceipts: options.laneReceipts,
			claimHistory: this.claimHistory,
			laneDag: this.laneDag.snapshot(),
			replayArtifact,
			priorSealedReceipt: priorSealedReceipt?.sealed ? priorSealedReceipt : null,
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
			metrics: this.executionPathMetrics,
			taskAmbiguityProfile: options.envelope.taskAmbiguityProfile,
			probeHistory: options.probeHistory,
		})
		this.normalizedResourceOwners = normalizedResourceOwners

		let sealed = mergeGate.passed && !options.forceFail && mergeGate.confidenceAwareConvergence?.decision !== "targeted_probe"
		let mergePassed = mergeGate.passed
		const completionPolicy = options.completionPolicy ?? "advisory_only"
		let replayMismatch = false

		const receipt: GovernedSwarmReceipt = {
			schemaVersion: GOVERNED_RECEIPT_SCHEMA_VERSION,
			swarmId: options.envelope.swarmId,
			executionId: options.envelope.executionId,
			taskId: options.taskId,
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
			admission: options.admission,
			laneReceipts: options.laneReceipts,
			laneDag: this.laneDag.snapshot().map((node) => ({
				index: node.index,
				laneId: node.laneId,
				dependsOn: node.dependsOn,
				state: node.state,
				agentId: node.agentId,
				executionMode: node.executionMode as LaneExecutionMode | undefined,
			})),
			claimHistory: [...this.claimHistory],
			mergeGate,
			replayArtifactPath: options.envelope.artifactPath,
			governedArtifactPath: buildGovernedArtifactRelativePath(options.envelope.swarmId, this.attemptId),
			sealedAt: Date.now(),
			sealed,
			retryReason: options.retryReason,
			integrity: {
				valid: sealed && mergeGate.replayIntegrity.valid,
				violations: mergeGate.violations,
				checksum: mergeGate.replayIntegrity.checksum,
			},
			confidenceAwareConvergence: mergeGate.confidenceAwareConvergence,
		}

		if (this.executionPathMetrics) {
			this.executionPathMetrics.replayValidationCalls++
		}
		const replayValidation = validateDeterministicReplay(receipt, replayArtifact, mergeGate.replayIntegrity)
		receipt.replayChecksum = replayValidation.deterministicChecksum
		if (!replayValidation.valid) {
			receipt.integrity.valid = false
			receipt.integrity.violations.push(...explainReplayMismatch(replayValidation.violations))
			receipt.sealed = false
			sealed = false
			replayMismatch = true
		}

		let unsafeRetry = mergeGate.sealedSupersessionBlocked
		if (unsafeRetry) {
			const supersessionHalt = evaluateCoordinatorHaltDecision({
				proposedReason: "unsealed retry cannot supersede prior sealed receipt",
				source: "merge_gate",
				context: buildCoordinatorContinuationContext(options.taskId, {
					swarmId: options.envelope.swarmId,
					attemptId: this.attemptId,
					parentAttemptId: this.parentAttemptId,
					authoritativeReceipt,
					latestPointerReceipt,
					hasRunningLanes: this.laneDag.snapshot().some((node) => node.state === "running"),
				}),
			})
			governanceDiagnostics = mergeGovernanceDiagnostics(governanceDiagnostics, supersessionHalt.diagnostics)
			if (!supersessionHalt.shouldHalt) {
				receipt.mergeGate.sealedSupersessionBlocked = false
				receipt.mergeGate.violations = receipt.mergeGate.violations.filter((v) => !v.includes("supersede prior sealed"))
				receipt.mergeGate.findings = receipt.mergeGate.findings?.filter(
					(finding) => finding.code !== "sealed_supersession",
				)
				receipt.mergeGate.passed = receipt.mergeGate.violations.length === 0
				receipt.mergeGate.retryDisposition = receipt.mergeGate.passed ? "not_needed" : "targeted_repair"
				mergePassed = receipt.mergeGate.passed
				unsafeRetry = false
				if (receipt.mergeGate.passed && !options.forceFail && !replayMismatch) {
					receipt.sealed = true
					sealed = true
					receipt.integrity.valid = mergeGate.replayIntegrity.valid
				}
			}
		}

		let currentWorkspaceSnapshotId: string | undefined
		let knownItemIds: Set<string> | undefined
		if (this.roadmapEnabled) {
			try {
				const state = await RoadmapService.getInstance().getOrHydrateRuntimeState(this.workspace)
				currentWorkspaceSnapshotId = computeRoadmapSnapshotId(state)
				knownItemIds = collectKnownRoadmapItemIds(state)
			} catch {
				currentWorkspaceSnapshotId = this.workspaceRoadmapSnapshotId
			}
		}

		const patchReconciliation = runRoadmapPatchReconciliation({
			laneReceipts: options.laneReceipts,
			laneDag: this.laneDag.snapshot(),
			workspaceSnapshotIdAtAdmit: this.workspaceRoadmapSnapshotId,
			currentWorkspaceSnapshotId,
			mergePassed: mergeGate.passed,
			knownItemIds,
		})

		const projectionViolations = [
			...auditDirectWorkspaceRoadmapMutation(options.laneReceipts),
			...patchReconciliation.violations,
		]
		if (projectionViolations.length > 0) {
			mergePassed = false
			receipt.mergeGate.passed = false
			receipt.mergeGate.violations.push(...projectionViolations)
			receipt.mergeGate.findings = [
				...(receipt.mergeGate.findings ?? []),
				...projectionViolations.map((message) => ({
					code: "roadmap_projection_conflict",
					severity: "blocking" as const,
					message,
					retryable: true,
					remediation: "Repair only rejected or conflicting roadmap patches; preserve completed lane results.",
				})),
			]
			receipt.mergeGate.retryDisposition = "targeted_repair"
			receipt.mergeGate.roadmapAudit = {
				safe: false,
				violations: [...(receipt.mergeGate.roadmapAudit?.violations ?? []), ...projectionViolations],
				overlappingResources: receipt.mergeGate.roadmapAudit?.overlappingResources ?? [],
				blockedWriters: receipt.mergeGate.roadmapAudit?.blockedWriters ?? [],
			}
			receipt.sealed = false
			sealed = false
			receipt.integrity.valid = false
			receipt.integrity.violations.push(...projectionViolations)
		}

		let workspaceCommit: import("@shared/subagent/roadmapProjection").RoadmapWorkspaceCommitResult | undefined
		if (sealed && patchReconciliation.passed && patchReconciliation.commitStatus === "pending") {
			workspaceCommit = await commitWorkspaceRoadmapPatches({
				workspace: this.workspace,
				coordinatorId: options.envelope.swarmId,
				reconciliation: patchReconciliation,
				lockAuthority: this.lockAuthority,
				roadmapEnabled: this.roadmapEnabled,
				mergePassed,
				integrityValid: receipt.integrity.valid,
				sealed,
				completionPolicy,
			})
			if (!workspaceCommit.committed) {
				receipt.sealed = false
				sealed = false
			}
		}

		receipt.roadmapLinkage = await this.finalizeRoadmapSealState({
			swarmId: options.envelope.swarmId,
			admission: options.admission,
			laneReceipts: options.laneReceipts,
			completionPolicy,
			sealed,
			mergePassed,
			integrityValid: receipt.integrity.valid,
			replayMismatch,
			unsafeRetry,
			releaseLease: true,
			patchReconciliation,
			workspaceCommit,
		})

		receipt.auditIntegration = buildGovernedAuditIntegration({
			preflightIssues: sealPreflightIssues,
			laneReceipts: options.laneReceipts,
			mergeGate,
			agents: options.envelope.agents,
			receiptIntegrityValid: receipt.integrity.valid,
			roadmapLinkage: receipt.roadmapLinkage,
			governanceDiagnostics,
		})

		const lateRoadmapViolations = [
			...auditRoadmapCompletionIntegrity(receipt.roadmapLinkage, mergeGate.passed, sealed),
			...auditStaleRoadmapOrchestrationLease(receipt.roadmapLinkage),
		]
		if (lateRoadmapViolations.length > 0) {
			receipt.mergeGate.passed = false
			receipt.mergeGate.violations.push(...lateRoadmapViolations)
			receipt.mergeGate.findings = [
				...(receipt.mergeGate.findings ?? []),
				...lateRoadmapViolations.map((message) => ({
					code: "roadmap_seal_integrity",
					severity: "blocking" as const,
					message,
					retryable: false,
					remediation: "Reconcile the coordinator roadmap lease or completion state before retry.",
				})),
			]
			receipt.mergeGate.retryDisposition = "retry_after_recovery"
			receipt.mergeGate.roadmapAudit = {
				safe: false,
				violations: [...(receipt.mergeGate.roadmapAudit?.violations ?? []), ...lateRoadmapViolations],
				overlappingResources: receipt.mergeGate.roadmapAudit?.overlappingResources ?? [],
				blockedWriters: receipt.mergeGate.roadmapAudit?.blockedWriters ?? [],
			}
			receipt.sealed = false
			receipt.integrity.valid = false
			receipt.integrity.violations.push(...lateRoadmapViolations)
		}

		if (receipt.auditIntegration) {
			receipt.auditIntegration.receiptIntegrityValidated = receipt.integrity.valid
			receipt.auditIntegration.workspaceAuditAtSeal = receipt.integrity.valid && mergeGate.passed
		}

		const validationSnapshotCurrent = options.validationSnapshot
			? options.envelope.checksum === options.validationSnapshot.executionChecksum
			: true
		const envelopeStructurallyValid = options.validationSnapshot?.report.validated ?? true
		const finalConvergence = evaluateConfidenceAwareConvergence({
			agents: options.envelope.agents,
			laneReceipts: options.laneReceipts,
			mergeFindings: receipt.mergeGate.findings,
			taskAmbiguityProfile: options.envelope.taskAmbiguityProfile,
			probeHistory: options.probeHistory,
			hardFailureReason: replayMismatch
				? "execution_provenance_corrupt"
				: options.forceFail
					? "required_invariant_violated"
					: undefined,
		})
		receipt.confidenceAwareConvergence = finalConvergence
		receipt.mergeGate.confidenceAwareConvergence = finalConvergence
		if (this.executionPathMetrics) {
			this.executionPathMetrics.lowConfidenceLanesAccepted = Math.max(
				this.executionPathMetrics.lowConfidenceLanesAccepted,
				finalConvergence.diagnostics.lowConfidenceLanesAccepted,
			)
			this.executionPathMetrics.confidenceOnlyRetriesSuppressed = Math.max(
				this.executionPathMetrics.confidenceOnlyRetriesSuppressed,
				finalConvergence.diagnostics.confidenceOnlyRetriesSuppressed,
			)
			this.executionPathMetrics.probeBudgetsExhausted = Math.max(
				this.executionPathMetrics.probeBudgetsExhausted,
				finalConvergence.diagnostics.probeBudgetsExhausted,
			)
			this.executionPathMetrics.convergedWithBoundedUncertainty = Math.max(
				this.executionPathMetrics.convergedWithBoundedUncertainty,
				finalConvergence.diagnostics.convergedWithBoundedUncertainty,
			)
			this.executionPathMetrics.trueHardBlocks = Math.max(
				this.executionPathMetrics.trueHardBlocks,
				finalConvergence.diagnostics.trueHardBlocks,
			)
		}
		receipt.continuationDecision = reduceGovernedContinuation({
			receipt,
			envelopeStructurallyValid,
			validatedStateUnchanged: validationSnapshotCurrent,
			recoveryActive: options.recoveryActive ?? false,
			metrics: this.executionPathMetrics,
		})
		receipt.executionPathMetrics = this.executionPathMetrics

		receipt.governedArtifactPath = await persistGovernedReceipt(options.taskId, receipt, {
			existingLatest: latestPointerReceipt,
			existingHistory: sealContext.history,
			metrics: this.executionPathMetrics,
		})
		return receipt
	}

	/** Seal a failed/partial receipt after crash or interruption — never reports success. */
	async sealCrashReceipt(options: {
		taskId: string
		swarmId: string
		executionId: string
		admission: GovernedAdmissionResult
		crashPhase: GovernedCrashPhase
		laneReceipts?: LaneExecutionReceipt[]
		artifactPath?: string
		retryReason?: string
		preflightIssues?: GatePreflightReadinessIssue[]
		completionPolicy?: RoadmapCompletionUpdatePolicy
	}): Promise<GovernedSwarmReceipt> {
		const laneReceipts = options.laneReceipts ?? []
		const completionPolicy = options.completionPolicy ?? "advisory_only"
		const emptyEnvelope: SwarmExecutionEnvelope = {
			swarmId: options.swarmId,
			executionId: options.executionId,
			taskId: options.taskId,
			continuity: {
				swarmId: options.swarmId,
				taskId: options.taskId,
				resumeToken: `${options.swarmId}:crash`,
				lastPersistedAt: Date.now(),
				completedAgents: laneReceipts.filter((l) => l.status === "completed").length,
				totalAgents: Math.max(laneReceipts.length, this.laneDag.snapshot().length),
				status: "failed",
			},
			agents: [],
			blackboardSnapshot: [],
			timestamps: { started: Date.now(), completed: Date.now() },
			status: "failed",
			invariants: { validated: false, violations: [`crash:${options.crashPhase}`] },
			artifactPath: options.artifactPath || `subagent_executions/${options.swarmId}.json`,
			schemaVersion: 1,
		}

		const { normalizedResourceOwners, ...mergeGate } = runMergeGate({
			agents: [],
			laneReceipts,
			claimHistory: this.claimHistory,
			laneDag: this.laneDag.snapshot(),
			replayArtifact: {
				schema: "execution.replay/v1",
				artifactId: options.swarmId,
				source: "swarm",
				taskId: options.taskId,
				status: "failed",
				startedAt: Date.now(),
				completedAt: Date.now(),
				lineage: [],
				timeline: [],
				checkpoints: [],
				artifactPointers: [],
				integrity: { valid: false, violations: [`crash:${options.crashPhase}`] },
				extension: { crashPhase: options.crashPhase },
			},
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
			metrics: this.executionPathMetrics,
		})
		this.normalizedResourceOwners = normalizedResourceOwners

		const mergeViolations = [`crash at ${options.crashPhase}`, ...mergeGate.violations]
		const leaseSnapshotBeforeRelease = this.getOrchestrationLeaseSnapshot()
		await this.releaseSwarmOrchestrationLease()
		const leaseSnapshot = this.getOrchestrationLeaseSnapshot()
		if (leaseSnapshotBeforeRelease?.acquired && leaseSnapshot?.unreleasedRisk) {
			mergeViolations.push("orchestration lease unreleased after crash")
		}

		const receipt: GovernedSwarmReceipt = {
			schemaVersion: GOVERNED_RECEIPT_SCHEMA_VERSION,
			swarmId: options.swarmId,
			executionId: options.executionId,
			taskId: options.taskId,
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
			admission: options.admission,
			laneReceipts,
			laneDag: this.laneDag.snapshot(),
			claimHistory: [...this.claimHistory],
			mergeGate: {
				...mergeGate,
				passed: false,
				violations: mergeViolations,
			},
			replayArtifactPath: emptyEnvelope.artifactPath,
			governedArtifactPath: buildGovernedArtifactRelativePath(options.swarmId, this.attemptId),
			sealedAt: Date.now(),
			sealed: false,
			retryReason: options.retryReason || `crash:${options.crashPhase}`,
			integrity: { valid: false, violations: [`crash:${options.crashPhase}`], checksum: "" },
			confidenceAwareConvergence: mergeGate.confidenceAwareConvergence,
		}

		receipt.roadmapLinkage = await this.finalizeRoadmapSealState({
			swarmId: options.swarmId,
			admission: options.admission,
			laneReceipts,
			completionPolicy,
			sealed: false,
			mergePassed: false,
			integrityValid: false,
			replayMismatch: false,
			unsafeRetry: false,
			releaseLease: false,
		})

		receipt.auditIntegration = buildGovernedAuditIntegration({
			preflightIssues: options.preflightIssues ?? [],
			laneReceipts,
			mergeGate: receipt.mergeGate,
			agents: [],
			receiptIntegrityValid: false,
			roadmapLinkage: receipt.roadmapLinkage,
		})
		receipt.continuationDecision = reduceGovernedContinuation({
			receipt,
			envelopeStructurallyValid: false,
			validatedStateUnchanged: true,
			recoveryActive: true,
			interrupted: true,
			metrics: this.executionPathMetrics,
		})
		receipt.executionPathMetrics = this.executionPathMetrics

		receipt.governedArtifactPath = await persistGovernedReceipt(options.taskId, receipt, {
			metrics: this.executionPathMetrics,
		})
		return receipt
	}

	async buildReceiptSummary(receipt: GovernedSwarmReceipt): Promise<GovernedReceiptSummary> {
		const history = this.receiptHistoryCache ?? (await listGovernedReceiptHistory(receipt.taskId, receipt.swarmId))
		return buildGovernedReceiptSummary(receipt, history, this.normalizedResourceOwners, this.executionPathMetrics)
	}

	buildLiveReceiptSummary(
		swarmId: string,
		admission: GovernedAdmissionResult,
		laneReceipts: LaneExecutionReceipt[],
		startedAt: number,
	): GovernedReceiptSummary {
		const collisionRejections = laneReceipts.filter((lane) => lane.status === "collision_rejected").length
		const lanesFailed = laneReceipts.filter((lane) => lane.status === "failed").length
		const dagSnapshot = this.laneDag.snapshot()
		const lanesSealed = dagSnapshot.filter((lane) => lane.state === "sealed").length
		const lanesBlocked = dagSnapshot.filter((lane) => lane.state === "blocked").length
		const lanesRunning = dagSnapshot.filter((lane) => lane.state === "running").length
		const partialReceipt: GovernedSwarmReceipt = {
			schemaVersion: GOVERNED_RECEIPT_SCHEMA_VERSION,
			swarmId,
			executionId: "",
			taskId: "",
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
			admission,
			laneReceipts,
			laneDag: dagSnapshot,
			claimHistory: [...this.claimHistory],
			mergeGate: {
				passed: false,
				mergeAudit: { safe: false, violations: [], overlappingPaths: [], missingEvidence: [], placeholderWarnings: [] },
				replayIntegrity: { valid: false, violations: [], checksum: "" },
				violations: [],
				failedLaneCount: lanesFailed,
				orphanedClaimCount: laneReceipts.filter((lane) => !lane.claimReleased).length,
				staleLeaseCount: 0,
				splitBrainDetected: false,
				sealedSupersessionBlocked: false,
			},
			replayArtifactPath: "",
			governedArtifactPath: buildGovernedArtifactRelativePath(swarmId, this.attemptId),
			sealedAt: 0,
			sealed: false,
			integrity: { valid: false, violations: [], checksum: "" },
		}

		return {
			swarmId,
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
			admitted: admission.admitted,
			admissionReason: admission.reason,
			mergePassed: false,
			sealed: false,
			laneCount: laneReceipts.length,
			lanesSealed,
			lanesFailed,
			lanesBlocked,
			lanesRunning,
			collisionRejections,
			orphanedClaims: laneReceipts.filter((lane) => !lane.claimReleased && lane.status !== "skipped").length,
			integrityValid: false,
			evidenceComplete: false,
			replayIntegrityValid: false,
			splitBrainDetected: false,
			governedArtifactPath: buildGovernedArtifactRelativePath(swarmId, this.attemptId),
			replayArtifactPath: "",
			violations: [],
			laneStates: laneReceipts.map((lane) => ({
				index: lane.index,
				laneId: lane.laneId,
				status: lane.status,
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
			})),
			laneDag: dagSnapshot,
			claimTimeline: buildClaimTimeline(admission, this.claimHistory, { admittedAt: startedAt }),
			resourceOwners: buildResourceOwners(this.claimHistory),
			retryHistory: [],
			diagnostics: buildReceiptDiagnostics(partialReceipt, [], { inProgress: true }),
		}
	}
}
