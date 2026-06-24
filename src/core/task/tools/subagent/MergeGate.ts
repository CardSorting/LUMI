import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	GovernedSwarmReceipt,
	LaneDAGNode,
	LaneExecutionReceipt,
	MergeGateResult,
	MergeSafetyAudit,
} from "@shared/subagent/governedExecution"
import { verifyReplayArtifact } from "./executionReplayMappers"
import { explainReplayMismatch, validateDeterministicReplay } from "./ReplayValidator"

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

function auditOverlappingPaths(agents: SubagentExecutionEnvelope[], laneDag: LaneDAGNode[]): MergeSafetyAudit {
	const violations: string[] = []
	const overlappingPaths: MergeSafetyAudit["overlappingPaths"] = []
	const pathToAgents = new Map<string, Array<{ agentId: string; index: number }>>()

	for (const agent of agents) {
		const laneIndex = agent.lineage?.index ?? agents.indexOf(agent)
		for (const filePath of agent.touchedFiles || []) {
			const list = pathToAgents.get(filePath) || []
			list.push({ agentId: agent.agentId, index: laneIndex })
			pathToAgents.set(filePath, list)
		}
	}

	for (const [filePath, holders] of pathToAgents.entries()) {
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
			violations.push(`unsafe overlap on '${filePath}': ${uniqueAgents.join(", ")}`)
		}
	}

	return { safe: violations.length === 0, violations, overlappingPaths, missingEvidence: [], placeholderWarnings: [] }
}

function auditMissingTranscripts(laneReceipts: LaneExecutionReceipt[]): string[] {
	return laneReceipts.filter((lane) => lane.status === "completed" && !lane.transcriptArtifactPath).map((lane) => lane.laneId)
}

function auditMissingToolEvidence(laneReceipts: LaneExecutionReceipt[]): string[] {
	return laneReceipts
		.filter((lane) => lane.status === "completed" && (lane.toolStepCount ?? 0) === 0 && (lane.evidenceCount ?? 0) === 0)
		.map((lane) => lane.laneId)
}

function auditMissingEvidence(agents: SubagentExecutionEnvelope[], laneReceipts: LaneExecutionReceipt[]): string[] {
	const completedAgentIds = new Set(laneReceipts.filter((lane) => lane.status === "completed").map((lane) => lane.agentId))
	return agents
		.filter((agent) => completedAgentIds.has(agent.agentId) && (agent.evidenceRefs?.length ?? 0) === 0)
		.map((agent) => agent.agentId)
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

function auditOrphanedClaims(claimHistory: ClaimHistoryEntry[]): number {
	const acquired = new Map<string, string>()
	let orphaned = 0

	for (const entry of claimHistory) {
		if (entry.event === "acquired" || entry.event === "recovered") {
			acquired.set(entry.resourceKey, entry.ownerId)
		} else if (entry.event === "released") {
			acquired.delete(entry.resourceKey)
		} else if (entry.event === "stale_detected") {
			acquired.delete(entry.resourceKey)
			orphaned++
		}
	}

	return orphaned + acquired.size
}

function auditStaleLeases(claimHistory: ClaimHistoryEntry[]): number {
	return claimHistory.filter((entry) => entry.event === "stale_detected").length
}

function auditDuplicateClaims(claimHistory: ClaimHistoryEntry[]): string[] {
	const active = new Map<string, string>()
	const violations: string[] = []

	for (const entry of claimHistory) {
		if (entry.event !== "acquired" && entry.event !== "recovered") {
			if (entry.event === "released") {
				active.delete(entry.resourceKey)
			}
			continue
		}
		const existing = active.get(entry.resourceKey)
		if (existing && existing !== entry.ownerId) {
			violations.push(`duplicate claim on '${entry.resourceKey}': ${existing}, ${entry.ownerId}`)
		}
		active.set(entry.resourceKey, entry.ownerId)
	}

	return violations
}

function auditSplitBrain(claimHistory: ClaimHistoryEntry[]): boolean {
	const byResource = new Map<string, Set<string>>()
	for (const entry of claimHistory) {
		if (entry.event === "acquired" || entry.event === "recovered") {
			const owners = byResource.get(entry.resourceKey) || new Set()
			owners.add(`${entry.ownerId}:${entry.fencingToken}`)
			byResource.set(entry.resourceKey, owners)
		}
	}
	for (const owners of byResource.values()) {
		if (owners.size > 1) {
			return true
		}
	}
	return false
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
export function runMergeGate(input: MergeGateInput): MergeGateResult {
	const violations: string[] = []
	const overlapAudit = auditOverlappingPaths(input.agents, input.laneDag)
	violations.push(...overlapAudit.violations)

	const missingEvidence = auditMissingEvidence(input.agents, input.laneReceipts)
	if (missingEvidence.length > 0) {
		violations.push(`missing evidence: ${missingEvidence.join(", ")}`)
	}

	const placeholderWarnings = auditPlaceholders(input.agents)
	if (placeholderWarnings.length > 0) {
		violations.push(`unresolved placeholders: ${placeholderWarnings.join(", ")}`)
	}

	const missingTranscripts = auditMissingTranscripts(input.laneReceipts)
	if (missingTranscripts.length > 0) {
		violations.push(`missing transcript pointer: ${missingTranscripts.join(", ")}`)
	}

	const missingToolEvidence = auditMissingToolEvidence(input.laneReceipts)
	if (missingToolEvidence.length > 0) {
		violations.push(`missing tool evidence: ${missingToolEvidence.join(", ")}`)
	}

	const laneStatusViolations = auditLaneStatusMismatch(input.agents, input.laneReceipts)
	violations.push(...laneStatusViolations)

	const failedLanes = input.laneReceipts.filter((lane) => lane.status === "failed")
	if (failedLanes.length > 0) {
		violations.push(`failed lanes: ${failedLanes.map((l) => l.laneId).join(", ")}`)
	}

	const unsealedLanes = input.laneDag.filter((node) => node.state !== "sealed" && node.state !== "failed")
	if (unsealedLanes.length > 0) {
		violations.push(`unsealed DAG nodes: ${unsealedLanes.map((n) => n.laneId).join(", ")}`)
	}

	const duplicateViolations = auditDuplicateClaims(input.claimHistory)
	violations.push(...duplicateViolations)
	violations.push(...auditDuplicateClaimIds(input.claimHistory))

	const splitBrainDetected = auditSplitBrain(input.claimHistory)
	if (splitBrainDetected) {
		violations.push("split-brain lock authority detected")
	}

	const orphanedClaimCount = auditOrphanedClaims(input.claimHistory)
	if (orphanedClaimCount > 0) {
		violations.push(`orphaned claims: ${orphanedClaimCount}`)
	}

	const staleLeaseCount = auditStaleLeases(input.claimHistory)
	if (staleLeaseCount > 0) {
		violations.push(`stale leases: ${staleLeaseCount}`)
	}

	const replayIntegrity = verifyReplayArtifact(input.replayArtifact)
	if (!replayIntegrity.valid) {
		violations.push(...replayIntegrity.violations)
	}

	const sealedSupersessionBlocked = auditSealedSupersession(
		input.priorSealedReceipt,
		input.attemptId,
		input.parentAttemptId,
		input.laneDag,
	)
	if (sealedSupersessionBlocked) {
		violations.push("unsealed retry cannot supersede prior sealed receipt")
	}

	if (input.storedReplayChecksum) {
		const replayProbe = validateDeterministicReplay(
			{
				schemaVersion: 3,
				swarmId: input.replayArtifact.artifactId,
				executionId: input.replayArtifact.executionId || "",
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
		)
		if (!replayProbe.valid) {
			violations.push(...explainReplayMismatch(replayProbe.violations))
		}
	}

	const unreleased = input.laneReceipts.filter(
		(lane) => !lane.claimReleased && lane.status !== "collision_rejected" && lane.status !== "skipped",
	)
	if (unreleased.length > 0) {
		violations.push(`unreleased claims: ${unreleased.map((l) => l.laneId).join(", ")}`)
	}

	const mergeAudit: MergeSafetyAudit = {
		safe: violations.length === 0,
		violations,
		overlappingPaths: overlapAudit.overlappingPaths,
		missingEvidence,
		placeholderWarnings,
	}

	return {
		passed: violations.length === 0,
		mergeAudit,
		replayIntegrity,
		violations,
		failedLaneCount: failedLanes.length,
		orphanedClaimCount,
		staleLeaseCount,
		splitBrainDetected,
		sealedSupersessionBlocked,
	}
}
