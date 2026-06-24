import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	GovernedAdmissionResult,
	GovernedReceiptSummary,
	GovernedSwarmReceipt,
	LaneExecutionReceipt,
	LaneExecutionStatus,
	WorkLaneClaim,
} from "@shared/subagent/governedExecution"
import {
	buildClaimTimeline,
	buildGovernedReceiptSummary,
	buildLaneId,
	buildMutexResourceKey,
	buildResourceOwners,
	buildRoadmapLeaseTaskId,
	GOVERNED_RECEIPT_SCHEMA_VERSION,
	lockClaimToHistoryEntry,
	workLaneClaimFromLock,
} from "@shared/subagent/governedExecution"
import { v4 as uuidv4 } from "uuid"
import type { LockAuthority } from "@/core/governance/LockAuthority"
import { createLockAuthority, releaseGovernedLock } from "@/core/governance/LockAuthority"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { swarmEnvelopeToReplayArtifact } from "./executionReplayMappers"
import {
	buildGovernedArtifactRelativePath,
	listGovernedReceiptHistory,
	loadGovernedReceipt,
	persistGovernedReceipt,
} from "./GovernedExecutionStore"
import { LaneDAG } from "./LaneDAG"
import { runMergeGate } from "./MergeGate"
import { validateDeterministicReplay } from "./ReplayValidator"

const LANE_LEASE_SECONDS = 600
const LANE_MUTEX_MS = LANE_LEASE_SECONDS * 1000

export class GovernedSwarmCoordinator {
	private readonly lockAuthority: LockAuthority
	private readonly laneDag: LaneDAG
	private readonly claimHistory: ClaimHistoryEntry[] = []
	private readonly attemptId: string

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
			return { admitted: true, backoffMs: 0, reason: "roadmap_disabled" }
		}

		const admission = await RoadmapService.getInstance().scheduleAdmission(this.workspace, parentAgentId, operation)
		if (!admission.admitted) {
			return {
				admitted: false,
				backoffMs: admission.backoff_ms,
				reason: "roadmap_pressure",
			}
		}

		return { admitted: true, backoffMs: 0 }
	}

	isLaneReady(index: number): boolean {
		const node = this.laneDag.getNode(index)
		return node?.state === "ready"
	}

	async acquireLane(
		swarmId: string,
		agentId: string,
		index: number,
	): Promise<{ success: boolean; claim?: WorkLaneClaim; error?: string }> {
		const laneId = buildLaneId(swarmId, index)
		const node = this.laneDag.getNode(index)

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
		this.laneDag.markRunning(index, agentId)

		return {
			success: true,
			claim: workLaneClaimFromLock(result.claim, swarmId, index, laneId),
		}
	}

	async releaseLane(claim: WorkLaneClaim, sealed: boolean, failed = false, error?: string): Promise<void> {
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

		const receipt: LaneExecutionReceipt = {
			laneId: claim.laneId,
			agentId: claim.agentId,
			index: claim.index,
			status,
			dagState: dagNode?.state,
			attemptId: this.attemptId,
			claimId: claim.lockClaim?.claimId,
			claimReleased,
			evidenceCount: envelope?.evidenceRefs.length ?? 0,
			touchedFiles: envelope?.touchedFiles ?? [],
			transcriptArtifactPath: envelope?.transcriptArtifactPath,
			toolStepCount: envelope?.toolSteps.length ?? 0,
			sealedAt: Date.now(),
			acquiredAt: claim.lockClaim?.acquiredAt,
			releasedAt: claim.lockClaim?.releasedAt,
			fencingToken: claim.lockClaim?.fencingToken,
			lockBackends: claim.lockClaim?.backends,
			placeholderWarnings: placeholderWarnings.length ? placeholderWarnings : undefined,
			auditResult: status === "completed" && claimReleased && !placeholderWarnings.length ? "passed" : "failed",
			error,
		}

		return receipt
	}

	async sealReceipt(options: {
		taskId: string
		envelope: SwarmExecutionEnvelope
		admission: GovernedAdmissionResult
		laneReceipts: LaneExecutionReceipt[]
		replayArtifact?: ExecutionReplayArtifact
		forceFail?: boolean
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
			})),
			claimHistory: [...this.claimHistory],
			mergeGate,
			replayArtifactPath: options.envelope.artifactPath,
			governedArtifactPath: buildGovernedArtifactRelativePath(options.envelope.swarmId, this.attemptId),
			sealedAt: Date.now(),
			sealed,
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
			receipt.integrity.violations.push(...replayValidation.violations)
			receipt.sealed = false
			sealed = false
		}

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
			})),
			laneDag: dagSnapshot,
			claimTimeline: buildClaimTimeline(admission, this.claimHistory, { admittedAt: startedAt }),
			resourceOwners: buildResourceOwners(this.claimHistory),
			retryHistory: [],
		}
	}
}
