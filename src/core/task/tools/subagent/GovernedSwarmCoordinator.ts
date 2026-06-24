import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	GovernedAdmissionResult,
	GovernedCrashPhase,
	GovernedOrchestrationLease,
	GovernedReceiptSummary,
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
import { swarmEnvelopeToReplayArtifact } from "./executionReplayMappers"
import {
	buildGovernedArtifactRelativePath,
	listGovernedReceiptHistory,
	loadGovernedReceipt,
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

	constructor(
		private readonly workspace: string,
		private readonly roadmapEnabled: boolean,
		laneCount: number,
		dependencies?: Map<number, number[]>,
		lockAuthority?: LockAuthority,
		attemptId?: string,
		private readonly parentAttemptId?: string,
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

			const verify = await this.lockAuthority.verify(result.claim, this.workspace)
			if (!verify.valid) {
				await releaseGovernedLock(this.lockAuthority, result.claim, this.workspace)
				this.claimHistory.push(
					lockClaimToHistoryEntry(
						result.claim,
						laneId,
						verify.reason === "stale_owner" ? "stale_detected" : "rejected",
						verify.reason,
					),
				)
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

		this.laneDag.markRunning(index, agentId, resolvedIntent.executionMode)
		if (lockSkipped) {
			return { success: true, lockSkipped: true, claim }
		}
		return { success: true, claim }
	}

	async releaseLane(claim: WorkLaneClaim, sealed: boolean, failed = false, error?: string): Promise<void> {
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

		if (sealed) {
			this.laneDag.markSealed(claim.index)
		} else if (failed) {
			this.laneDag.markFailed(claim.index, error)
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
	}): Promise<GovernedSwarmReceipt> {
		const replayArtifact = options.replayArtifact || swarmEnvelopeToReplayArtifact(options.envelope)
		const priorSealedReceipt = await loadGovernedReceipt(options.taskId, options.envelope.swarmId)

		const mergeGate = runMergeGate({
			agents: options.envelope.agents,
			laneReceipts: options.laneReceipts,
			claimHistory: this.claimHistory,
			laneDag: this.laneDag.snapshot(),
			replayArtifact,
			priorSealedReceipt: priorSealedReceipt?.sealed ? priorSealedReceipt : null,
			attemptId: this.attemptId,
			parentAttemptId: this.parentAttemptId,
		})

		let sealed = mergeGate.passed && !options.forceFail
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
		}

		const replayValidation = validateDeterministicReplay(receipt, replayArtifact)
		receipt.replayChecksum = replayValidation.deterministicChecksum
		if (!replayValidation.valid) {
			receipt.integrity.valid = false
			receipt.integrity.violations.push(...explainReplayMismatch(replayValidation.violations))
			receipt.sealed = false
			sealed = false
			replayMismatch = true
		}

		const unsafeRetry = mergeGate.sealedSupersessionBlocked

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
			preflightIssues: options.preflightIssues ?? [],
			laneReceipts: options.laneReceipts,
			mergeGate,
			agents: options.envelope.agents,
			receiptIntegrityValid: receipt.integrity.valid,
			roadmapLinkage: receipt.roadmapLinkage,
		})

		const lateRoadmapViolations = [
			...auditRoadmapCompletionIntegrity(receipt.roadmapLinkage, mergeGate.passed, sealed),
			...auditStaleRoadmapOrchestrationLease(receipt.roadmapLinkage),
		]
		if (lateRoadmapViolations.length > 0) {
			receipt.mergeGate.passed = false
			receipt.mergeGate.violations.push(...lateRoadmapViolations)
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

		receipt.governedArtifactPath = await persistGovernedReceipt(options.taskId, receipt)
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

		const mergeGate = runMergeGate({
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
		})

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

		receipt.governedArtifactPath = await persistGovernedReceipt(options.taskId, receipt)
		return receipt
	}

	async buildReceiptSummary(receipt: GovernedSwarmReceipt): Promise<GovernedReceiptSummary> {
		const history = await listGovernedReceiptHistory(receipt.taskId, receipt.swarmId)
		return buildGovernedReceiptSummary(receipt, history)
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
