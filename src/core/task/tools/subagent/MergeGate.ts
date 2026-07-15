import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import type { SubagentExecutionEnvelope, TaskAmbiguityProfile } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	ConfidenceProbeHistoryEntry,
	GovernedContradiction,
	GovernedExecutionPathMetrics,
	GovernedResourceOwner,
	GovernedRoadmapLinkage,
	GovernedSwarmReceipt,
	LaneDAGNode,
	LaneExecutionReceipt,
	MergeGateFinding,
	MergeGateResult,
	MergeGateRetryDisposition,
	MergeSafetyAudit,
} from "@shared/subagent/governedExecution"
import { evaluateConfidenceAwareConvergence } from "./ConfidenceAwareConvergence"
import { verifyReplayArtifact } from "./executionReplayMappers"
import { envelopeIndicatesWrites } from "./LockNecessity"
import { explainReplayMismatch, validateDeterministicReplay } from "./ReplayValidator"
import { runRoadmapMergeAudit } from "./RoadmapMergeAudit"

export interface MergeGateInput {
	agents: SubagentExecutionEnvelope[]
	laneReceipts: LaneExecutionReceipt[]
	claimHistory: ClaimHistoryEntry[]
	laneDag: LaneDAGNode[]
	replayArtifact: ExecutionReplayArtifact
	priorSealedReceipt?: GovernedSwarmReceipt | null
	attemptId?: string
	parentAttemptId?: string
	storedReplayChecksum?: string
	roadmapLinkage?: GovernedRoadmapLinkage
	sealed?: boolean
	metrics?: GovernedExecutionPathMetrics
	taskAmbiguityProfile?: TaskAmbiguityProfile
	contradictions?: GovernedContradiction[]
	probeHistory?: ConfidenceProbeHistoryEntry[]
}

export interface MergeGateEvaluation extends MergeGateResult {
	normalizedResourceOwners: GovernedResourceOwner[]
}

function laneDependsOn(ancestor: number, descendant: number, dag: LaneDAGNode[]): boolean {
	if (ancestor === descendant) {
		return false
	}
	const node = dag.find((n) => n.index === descendant)
	if (!node) {
		return false
	}
	if (node.dependsOn.includes(ancestor)) {
		return true
	}
	return node.dependsOn.some((dep) => laneDependsOn(ancestor, dep, dag))
}

function isOverlapAllowedByDag(indexA: number, indexB: number, laneDag: LaneDAGNode[]): boolean {
	if (indexA === indexB) {
		return true
	}
	return laneDependsOn(indexA, indexB, laneDag) || laneDependsOn(indexB, indexA, laneDag)
}

/** Collision detection scoped to mutation write sets only. */
function auditMutationWriteOverlaps(laneReceipts: LaneExecutionReceipt[], laneDag: LaneDAGNode[]): MergeSafetyAudit {
	const violations: string[] = []
	const overlappingPaths: MergeSafetyAudit["overlappingPaths"] = []
	const pathToLanes = new Map<string, Array<{ agentId: string; index: number }>>()

	for (const lane of laneReceipts) {
		const writePaths = lane.writeSet?.length ? lane.writeSet : lane.lockRequired ? lane.touchedFiles : []
		for (const filePath of writePaths) {
			const list = pathToLanes.get(filePath) || []
			list.push({ agentId: lane.agentId, index: lane.index })
			pathToLanes.set(filePath, list)
		}
	}

	for (const [filePath, holders] of pathToLanes.entries()) {
		if (holders.length < 2) {
			continue
		}
		const uniqueAgents = [...new Set(holders.map((h) => h.agentId))]
		overlappingPaths.push({ path: filePath, agents: uniqueAgents })

		let allowed = true
		for (let i = 0; i < holders.length; i++) {
			for (let j = i + 1; j < holders.length; j++) {
				if (!isOverlapAllowedByDag(holders[i].index, holders[j].index, laneDag)) {
					allowed = false
					break
				}
			}
			if (!allowed) {
				break
			}
		}

		if (!allowed) {
			violations.push(`unsafe mutation overlap on '${filePath}': ${uniqueAgents.join(", ")}`)
		}
	}

	return { safe: violations.length === 0, violations, overlappingPaths, missingEvidence: [], placeholderWarnings: [] }
}

function auditMissingEvidence(agents: SubagentExecutionEnvelope[]): string[] {
	return agents.filter((agent) => (agent.evidenceRefs?.length ?? 0) === 0).map((agent) => agent.agentId)
}

function auditPlaceholders(agents: SubagentExecutionEnvelope[]): string[] {
	const warnings: string[] = []
	const placeholderPattern = /\b(TODO|FIXME|PLACEHOLDER|TBD)\b/i
	for (const agent of agents) {
		if (agent.verbatimOutput && placeholderPattern.test(agent.verbatimOutput)) {
			warnings.push(agent.agentId)
		}
	}
	return warnings
}

function claimIdentity(entry: ClaimHistoryEntry): string {
	return entry.claimId || `${entry.resourceKey}:${entry.ownerId}:${entry.fencingToken}`
}

interface ClaimLifecycleState {
	active: Map<string, ClaimHistoryEntry>
	unresolvedStale: Map<string, ClaimHistoryEntry>
	resourceOwners: Map<string, GovernedResourceOwner>
}

/** Reconstruct current ownership; historical stale events stop blocking after a matching release. */
function reconcileClaimLifecycle(claimHistory: ClaimHistoryEntry[]): ClaimLifecycleState {
	const active = new Map<string, ClaimHistoryEntry>()
	const unresolvedStale = new Map<string, ClaimHistoryEntry>()
	const resourceOwners = new Map<string, GovernedResourceOwner>()

	for (const entry of claimHistory) {
		const key = claimIdentity(entry)
		if (entry.event === "acquired" || entry.event === "recovered") {
			active.set(key, entry)
			unresolvedStale.delete(key)
			resourceOwners.set(entry.resourceKey, {
				resourceKey: entry.resourceKey,
				ownerId: entry.ownerId,
				laneId: entry.laneId,
				claimId: entry.claimId,
				fencingToken: entry.fencingToken,
				lockBackends: entry.lockBackends,
				status: "active",
			})
		} else if (entry.event === "stale_detected") {
			unresolvedStale.set(key, entry)
			const owner = resourceOwners.get(entry.resourceKey)
			if (owner) {
				owner.status = "stale"
			}
		} else if (entry.event === "released") {
			active.delete(key)
			unresolvedStale.delete(key)
			resourceOwners.set(entry.resourceKey, {
				resourceKey: entry.resourceKey,
				ownerId: entry.ownerId,
				laneId: entry.laneId,
				claimId: entry.claimId,
				fencingToken: entry.fencingToken,
				lockBackends: entry.lockBackends,
				status: "released",
			})
		}
	}

	return { active, unresolvedStale, resourceOwners }
}

function auditOrphanedClaims(lifecycle: ClaimLifecycleState, laneReceipts: LaneExecutionReceipt[]): number {
	let orphaned = 0
	for (const entry of lifecycle.active.values()) {
		const lane = laneReceipts.find((l) => l.laneId === entry.laneId)
		if (lane && !lane.lockRequired && !lane.roadmapMutationLockRequired) {
			continue
		}
		orphaned++
	}

	return orphaned
}

function auditStaleLeases(lifecycle: ClaimLifecycleState, laneReceipts: LaneExecutionReceipt[]): number {
	const lockSkipped = new Set(
		laneReceipts.filter((lane) => !lane.lockRequired && !lane.roadmapMutationLockRequired).map((lane) => lane.laneId),
	)
	return [...lifecycle.unresolvedStale.values()].filter((entry) => !lockSkipped.has(entry.laneId)).length
}

function auditDuplicateClaims(claimHistory: ClaimHistoryEntry[]): string[] {
	const active = new Map<string, Map<string, ClaimHistoryEntry>>()
	const violations: string[] = []

	for (const entry of claimHistory) {
		if (entry.event !== "acquired" && entry.event !== "recovered") {
			if (entry.event === "released") {
				const holders = active.get(entry.resourceKey)
				holders?.delete(claimIdentity(entry))
				if (holders?.size === 0) {
					active.delete(entry.resourceKey)
				}
			}
			continue
		}
		const holders = active.get(entry.resourceKey) ?? new Map<string, ClaimHistoryEntry>()
		const existing = [...holders.values()].find((holder) => holder.ownerId !== entry.ownerId)
		if (existing) {
			violations.push(`duplicate claim on '${entry.resourceKey}': ${existing.ownerId}, ${entry.ownerId}`)
		}
		holders.set(claimIdentity(entry), entry)
		active.set(entry.resourceKey, holders)
	}

	return violations
}

function auditSplitBrain(claimHistory: ClaimHistoryEntry[]): boolean {
	const activeByResource = new Map<string, Map<string, ClaimHistoryEntry>>()

	for (const entry of claimHistory) {
		if (entry.event === "released") {
			const owners = activeByResource.get(entry.resourceKey)
			owners?.delete(claimIdentity(entry))
			if (owners?.size === 0) {
				activeByResource.delete(entry.resourceKey)
			}
			continue
		}
		if (entry.event === "acquired" || entry.event === "recovered") {
			const owners = activeByResource.get(entry.resourceKey) || new Map<string, ClaimHistoryEntry>()
			owners.set(claimIdentity(entry), entry)
			activeByResource.set(entry.resourceKey, owners)
		}
	}

	for (const owners of activeByResource.values()) {
		if (new Set([...owners.values()].map((entry) => `${entry.ownerId}:${entry.fencingToken}`)).size > 1) {
			return true
		}
	}
	return false
}

function auditMissingTranscripts(laneReceipts: LaneExecutionReceipt[]): string[] {
	return laneReceipts.filter((lane) => lane.status === "completed" && !lane.transcriptArtifactPath).map((lane) => lane.laneId)
}

function auditMissingToolEvidence(laneReceipts: LaneExecutionReceipt[]): string[] {
	return laneReceipts
		.filter((lane) => lane.status === "completed" && (lane.toolStepCount ?? 0) === 0 && lane.evidenceCount === 0)
		.map((lane) => lane.laneId)
}

function auditLaneStatusMismatch(agents: SubagentExecutionEnvelope[], laneReceipts: LaneExecutionReceipt[]): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		const agent = agents.find((a) => a.agentId === lane.agentId)
		if (!agent) {
			continue
		}
		if (lane.status === "completed" && agent.status === "failed") {
			violations.push(`lane ${lane.laneId} marked completed but agent status is ${agent.status}`)
		}
		if (lane.status === "failed" && agent.status === "completed") {
			violations.push(`failed lane marked successful in envelope: ${lane.laneId}`)
		}
		const agentValidity = agent.executionValidity ?? (agent.status === "completed" ? "valid" : "invalid")
		const laneValidity = lane.executionValidity ?? agentValidity
		if (laneValidity !== agentValidity) {
			violations.push(
				`lane ${lane.laneId} execution validity ${laneValidity} disagrees with agent validity ${agentValidity}`,
			)
		}
		if ((lane.status === "completed" || agent.status === "completed") && agentValidity === "invalid") {
			violations.push(`completed lane has structurally invalid execution: ${lane.laneId}`)
		}
	}
	return violations
}

function auditDuplicateClaimIds(claimHistory: ClaimHistoryEntry[]): string[] {
	const activeByClaimId = new Map<string, string>()
	const violations: string[] = []

	for (const entry of claimHistory) {
		if (!entry.claimId) {
			continue
		}
		if (entry.event === "released") {
			activeByClaimId.delete(entry.claimId)
			continue
		}
		if (entry.event === "acquired" || entry.event === "recovered") {
			if (activeByClaimId.has(entry.claimId)) {
				violations.push(
					`duplicate claimId '${entry.claimId}' on resources '${activeByClaimId.get(entry.claimId)}' and '${entry.resourceKey}'`,
				)
			}
			activeByClaimId.set(entry.claimId, entry.resourceKey)
		}
	}

	return violations
}

function auditMutationWithoutLock(laneReceipts: LaneExecutionReceipt[], agents: SubagentExecutionEnvelope[]): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		if (lane.executionMode !== "mutation") {
			continue
		}
		if (!lane.lockRequired || !lane.claimId) {
			violations.push(`mutation lane ${lane.laneId} missing governed lock`)
		}
		const agent = agents.find((a) => a.agentId === lane.agentId)
		if (lane.lockRequired && !lane.claimId && agent && envelopeIndicatesWrites(agent.toolSteps, agent.touchedFiles)) {
			violations.push(`mutation lane ${lane.laneId} performed writes without lock`)
		}
	}
	return violations
}

function auditNonMutatingWithWrites(laneReceipts: LaneExecutionReceipt[], agents: SubagentExecutionEnvelope[]): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		if (lane.lockRequired || lane.executionMode === "mutation") {
			continue
		}
		const agent = agents.find((a) => a.agentId === lane.agentId)
		const hasWrites =
			(lane.writeSet?.length ?? 0) > 0 || (agent && envelopeIndicatesWrites(agent.toolSteps, agent.touchedFiles))
		if (hasWrites && !lane.claimId) {
			violations.push(`non-mutating lane ${lane.laneId} (${lane.executionMode}) performed writes without lock`)
		}
	}
	return violations
}

function auditSealedSupersession(
	priorSealedReceipt: GovernedSwarmReceipt | null | undefined,
	attemptId?: string,
	parentAttemptId?: string,
	laneDag?: LaneDAGNode[],
): boolean {
	if (!priorSealedReceipt?.sealed || !priorSealedReceipt.mergeGate.passed) {
		return false
	}
	if (parentAttemptId && parentAttemptId === priorSealedReceipt.attemptId) {
		return false
	}
	if (attemptId === priorSealedReceipt.attemptId) {
		return false
	}
	const unsealed = laneDag?.some((node) => node.state !== "sealed" && node.state !== "failed")
	return Boolean(unsealed)
}

/**
 * Canonical merge gate — fail closed before swarm success.
 */
export function runMergeGate(input: MergeGateInput): MergeGateEvaluation {
	const violations: string[] = []
	const advisoryWarnings: string[] = []
	const findings: MergeGateFinding[] = []
	const addBlocking = (code: string, messages: string[], remediation: string, retryable = true): void => {
		for (const message of messages) {
			violations.push(message)
			findings.push({ code, severity: "blocking", message, retryable, remediation })
		}
	}
	const addAdvisory = (code: string, messages: string[], remediation: string): void => {
		for (const message of messages) {
			advisoryWarnings.push(message)
			findings.push({ code, severity: "advisory", message, retryable: false, remediation })
		}
	}

	const overlapAudit = auditMutationWriteOverlaps(input.laneReceipts, input.laneDag)
	addBlocking(
		"mutation_write_overlap",
		overlapAudit.violations,
		"Serialize only the conflicting lanes with a DAG dependency or split their write sets.",
	)

	addBlocking(
		"mutation_without_lock",
		auditMutationWithoutLock(input.laneReceipts, input.agents),
		"Re-run the affected mutation lane under a governed claim.",
	)
	addBlocking(
		"undeclared_mutation",
		auditNonMutatingWithWrites(input.laneReceipts, input.agents),
		"Escalate the affected lane to mutation mode and re-run that lane.",
	)

	const missingEvidence = auditMissingEvidence(input.agents)
	if (missingEvidence.length > 0) {
		addAdvisory(
			"evidence_reference_missing",
			[`missing evidence: ${missingEvidence.join(", ")}`],
			"Attach evidence references during follow-up; do not re-run completed work solely for this warning.",
		)
	}

	const placeholderWarnings = auditPlaceholders(input.agents)
	if (placeholderWarnings.length > 0) {
		addAdvisory(
			"placeholder_detected",
			[`unresolved placeholders: ${placeholderWarnings.join(", ")}`],
			"Review the referenced output and resolve placeholders only when they affect the requested deliverable.",
		)
	}

	const missingTranscripts = auditMissingTranscripts(input.laneReceipts)
	if (missingTranscripts.length > 0) {
		addAdvisory(
			"transcript_pointer_missing",
			[`missing transcript pointer: ${missingTranscripts.join(", ")}`],
			"Repair transcript persistence asynchronously; the sealed swarm envelope remains the replay source.",
		)
	}

	const missingToolEvidence = auditMissingToolEvidence(input.laneReceipts)
	if (missingToolEvidence.length > 0) {
		addAdvisory(
			"tool_evidence_missing",
			[`missing tool evidence: ${missingToolEvidence.join(", ")}`],
			"Request targeted evidence enrichment instead of retrying the whole swarm.",
		)
	}

	const laneStatusViolations = auditLaneStatusMismatch(input.agents, input.laneReceipts)
	addBlocking(
		"lane_status_mismatch",
		laneStatusViolations,
		"Reconcile the affected lane receipt with its execution envelope before seal.",
	)

	const failedLanes = input.laneReceipts.filter((lane) => lane.status === "failed")
	if (failedLanes.length > 0) {
		addBlocking(
			"failed_lanes",
			[`failed lanes: ${failedLanes.map((l) => l.laneId).join(", ")}`],
			"Resume or repair only failed lanes and their dependent descendants.",
		)
	}

	const unsealedLanes = input.laneDag.filter((node) => node.state !== "sealed" && node.state !== "failed")
	if (unsealedLanes.length > 0) {
		addBlocking(
			"incomplete_lane_dag",
			[`unsealed DAG nodes: ${unsealedLanes.map((n) => n.laneId).join(", ")}`],
			"Wait for running lanes or resume only incomplete DAG nodes.",
		)
	}

	const duplicateViolations = auditDuplicateClaims(input.claimHistory)
	addBlocking("duplicate_claim", duplicateViolations, "Recover conflicting ownership before any retry.", false)
	addBlocking(
		"duplicate_claim_id",
		auditDuplicateClaimIds(input.claimHistory),
		"Repair claim identity generation and inspect concurrent ownership before retry.",
		false,
	)

	const splitBrainDetected = auditSplitBrain(input.claimHistory)
	if (splitBrainDetected) {
		addBlocking(
			"split_brain",
			["split-brain lock authority detected"],
			"Reconcile lock backends and fencing tokens before retry.",
			false,
		)
	}

	const claimLifecycle = reconcileClaimLifecycle(input.claimHistory)
	if (input.metrics) {
		input.metrics.claimReconstructions++
	}
	const orphanedClaimCount = auditOrphanedClaims(claimLifecycle, input.laneReceipts)
	if (orphanedClaimCount > 0) {
		addBlocking(
			"orphaned_claim",
			[`orphaned claims: ${orphanedClaimCount}`],
			"Release or recover active mutation claims before retry.",
			false,
		)
	}

	const staleLeaseCount = auditStaleLeases(claimLifecycle, input.laneReceipts)
	if (staleLeaseCount > 0) {
		addBlocking(
			"stale_lease",
			[`stale leases: ${staleLeaseCount}`],
			"Recover unresolved stale leases, then retry only incomplete lanes.",
			false,
		)
	}

	const replayIntegrity = verifyReplayArtifact(input.replayArtifact)
	if (input.metrics) {
		input.metrics.replayValidationCalls++
	}
	if (!replayIntegrity.valid) {
		addBlocking(
			"replay_integrity",
			replayIntegrity.violations,
			"Repair or regenerate the replay artifact before merge.",
			false,
		)
	}

	const sealedSupersessionBlocked = auditSealedSupersession(
		input.priorSealedReceipt,
		input.attemptId,
		input.parentAttemptId,
		input.laneDag,
	)
	if (sealedSupersessionBlocked) {
		addBlocking(
			"sealed_supersession",
			["unsealed retry cannot supersede prior sealed receipt"],
			"Use the authoritative sealed result or link a deliberate child attempt via parentAttemptId.",
			false,
		)
	}

	if (input.storedReplayChecksum) {
		const replayProbe = validateDeterministicReplay(
			{
				schemaVersion: 3,
				swarmId: input.replayArtifact.artifactId,
				executionId: input.replayArtifact.artifactId,
				taskId: input.replayArtifact.taskId,
				attemptId: input.attemptId || "",
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: input.laneReceipts,
				laneDag: input.laneDag,
				claimHistory: input.claimHistory,
				mergeGate: {
					passed: violations.length === 0,
					mergeAudit: overlapAudit,
					replayIntegrity,
					violations: [],
					failedLaneCount: 0,
					orphanedClaimCount: 0,
					staleLeaseCount: 0,
					splitBrainDetected: false,
					sealedSupersessionBlocked: false,
				},
				replayArtifactPath: "",
				governedArtifactPath: "",
				sealedAt: 0,
				sealed: false,
				integrity: replayIntegrity,
				replayChecksum: input.storedReplayChecksum,
			},
			input.replayArtifact,
			replayIntegrity,
		)
		if (!replayProbe.valid) {
			addBlocking(
				"replay_checksum_mismatch",
				explainReplayMismatch(replayProbe.violations),
				"Restore the authoritative artifact or start a linked targeted attempt.",
				false,
			)
		}
	}

	const unreleased = input.laneReceipts.filter(
		(lane) =>
			lane.status !== "collision_rejected" &&
			((lane.lockRequired && !lane.claimReleased) ||
				(lane.roadmapMutationLockRequired && lane.roadmapMutationClaimReleased === false)),
	)
	if (unreleased.length > 0) {
		addBlocking(
			"unreleased_claim",
			[`unreleased claims: ${unreleased.map((l) => l.laneId).join(", ")}`],
			"Release active claims before retrying incomplete lanes.",
			false,
		)
	}

	const mergePassedProbe = violations.length === 0
	const roadmapAudit = runRoadmapMergeAudit({
		laneReceipts: input.laneReceipts,
		laneDag: input.laneDag,
		claimHistory: input.claimHistory,
		agents: input.agents,
		roadmapLinkage: input.roadmapLinkage,
		mergePassed: mergePassedProbe,
		sealed: input.sealed ?? mergePassedProbe,
	})
	addBlocking(
		"roadmap_merge_safety",
		roadmapAudit.violations,
		"Repair only conflicting or unauthorized roadmap mutations before commit.",
	)

	const confidenceAwareConvergence = evaluateConfidenceAwareConvergence({
		agents: input.agents,
		laneReceipts: input.laneReceipts,
		mergeFindings: findings,
		taskAmbiguityProfile: input.taskAmbiguityProfile,
		contradictions: input.contradictions,
		probeHistory: input.probeHistory,
	})
	if (confidenceAwareConvergence.decision === "converge_with_uncertainty") {
		addAdvisory(
			"bounded_uncertainty",
			["valid execution converged with bounded finding uncertainty"],
			"Preserve the uncertainty summary and gather only the listed resolution evidence when needed.",
		)
	}
	if (
		confidenceAwareConvergence.decision === "block_hard_failure" &&
		confidenceAwareConvergence.gateDecision.kind === "block_hard_failure" &&
		confidenceAwareConvergence.gateDecision.reason === "unsafe_under_all_interpretations"
	) {
		addBlocking(
			"critical_mutation_uncertainty",
			["critical mutation is unsafe under every surviving interpretation"],
			"Omit or reverse the unsafe mutation, or attach direct evidence resolving its critical assumption.",
			false,
		)
	}
	if (input.metrics) {
		const convergenceMetrics = confidenceAwareConvergence.diagnostics
		input.metrics.lowConfidenceLanesAccepted += convergenceMetrics.lowConfidenceLanesAccepted
		input.metrics.confidenceOnlyRetriesSuppressed += convergenceMetrics.confidenceOnlyRetriesSuppressed
		input.metrics.targetedProbesLaunched += convergenceMetrics.targetedProbesLaunched
		input.metrics.probeBudgetsExhausted += convergenceMetrics.probeBudgetsExhausted
		input.metrics.convergedWithBoundedUncertainty += convergenceMetrics.convergedWithBoundedUncertainty
		input.metrics.trueHardBlocks += convergenceMetrics.trueHardBlocks
	}

	const mergeAudit: MergeSafetyAudit = {
		safe: violations.length === 0,
		violations,
		overlappingPaths: overlapAudit.overlappingPaths,
		missingEvidence,
		placeholderWarnings,
	}
	const blockingCodes = new Set(findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.code))
	const retryDisposition: MergeGateRetryDisposition =
		confidenceAwareConvergence.decision === "targeted_probe"
			? "targeted_probe"
			: sealedSupersessionBlocked
				? "do_not_retry"
				: [...blockingCodes].some((code) =>
							[
								"duplicate_claim",
								"duplicate_claim_id",
								"split_brain",
								"orphaned_claim",
								"stale_lease",
								"unreleased_claim",
							].includes(code),
						)
					? "retry_after_recovery"
					: violations.length > 0
						? "targeted_repair"
						: "not_needed"

	return {
		passed: violations.length === 0,
		mergeAudit,
		roadmapAudit,
		replayIntegrity,
		violations,
		failedLaneCount: failedLanes.length,
		orphanedClaimCount,
		staleLeaseCount,
		splitBrainDetected,
		sealedSupersessionBlocked,
		findings,
		advisoryWarnings,
		retryDisposition,
		confidenceAwareConvergence,
		normalizedResourceOwners: [...claimLifecycle.resourceOwners.values()],
	}
}
