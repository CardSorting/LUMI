import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	GovernedRoadmapLinkage,
	LaneDAGNode,
	LaneExecutionReceipt,
	MergeRoadmapAudit,
} from "@shared/subagent/governedExecution"
import { envelopeIndicatesWrites } from "./LockNecessity"
import { envelopeIndicatesRoadmapWrites, isRoadmapResourceKey } from "./RoadmapMutation"

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

export function auditRoadmapWriteOverlaps(laneReceipts: LaneExecutionReceipt[], laneDag: LaneDAGNode[]): MergeRoadmapAudit {
	const violations: string[] = []
	const overlappingResources: MergeRoadmapAudit["overlappingResources"] = []
	const blockedWriters: string[] = []
	const resourceToLanes = new Map<string, Array<{ agentId: string; index: number }>>()

	for (const lane of laneReceipts) {
		for (const resource of lane.roadmapWriteSet ?? []) {
			const list = resourceToLanes.get(resource) || []
			list.push({ agentId: lane.agentId, index: lane.index })
			resourceToLanes.set(resource, list)
		}
	}

	for (const [resource, holders] of resourceToLanes.entries()) {
		if (holders.length < 2) {
			continue
		}
		const uniqueAgents = [...new Set(holders.map((h) => h.agentId))]
		overlappingResources.push({ resource, agents: uniqueAgents })

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
			violations.push(`unsafe roadmap mutation overlap on '${resource}': ${uniqueAgents.join(", ")}`)
			blockedWriters.push(...uniqueAgents)
		}
	}

	return {
		safe: violations.length === 0,
		violations,
		overlappingResources,
		blockedWriters: [...new Set(blockedWriters)],
	}
}

export function auditRoadmapMutationWithoutClaim(
	laneReceipts: LaneExecutionReceipt[],
	claimHistory: ClaimHistoryEntry[],
): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		if (!(lane.roadmapWriteSet?.length ?? 0)) {
			continue
		}
		const acquired = claimHistory.filter(
			(entry) => entry.laneId === lane.laneId && entry.event === "acquired" && isRoadmapResourceKey(entry.resourceKey),
		)
		if (!acquired.length) {
			violations.push(`roadmap mutation on ${lane.laneId} without roadmap mutation claim`)
		}
	}
	return violations
}

export function auditLockSkippedRoadmapMutation(
	laneReceipts: LaneExecutionReceipt[],
	agents: SubagentExecutionEnvelope[],
): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		if (lane.roadmapMutationLockRequired) {
			continue
		}
		const agent = agents.find((a) => a.agentId === lane.agentId)
		const wrote =
			(lane.roadmapWriteSet?.length ?? 0) > 0 ||
			(agent && envelopeIndicatesRoadmapWrites(agent.toolSteps, lane.roadmapWriteSet))
		if (wrote) {
			violations.push(`lock-skipped lane ${lane.laneId} (${lane.executionMode}) mutated roadmap without claim`)
		}
	}
	return violations
}

export function auditRoadmapCompletionIntegrity(
	roadmapLinkage: GovernedRoadmapLinkage | undefined,
	mergePassed: boolean,
	sealed: boolean,
): string[] {
	const violations: string[] = []
	if (!roadmapLinkage?.completionOutcome) {
		return violations
	}
	const outcome = roadmapLinkage.completionOutcome
	if (outcome.status === "updated" && !mergePassed) {
		violations.push("roadmap completion update recorded after failed merge")
	}
	if (outcome.status === "updated" && !sealed) {
		violations.push("roadmap completion update recorded on unsealed receipt")
	}
	if (outcome.status === "advisory_only" && outcome.reason === "roadmap_completion_applied") {
		violations.push("roadmap advisory mistaken for committed state")
	}
	return violations
}

export function auditStaleRoadmapOrchestrationLease(roadmapLinkage: GovernedRoadmapLinkage | undefined): string[] {
	if (roadmapLinkage?.orchestrationLease?.unreleasedRisk) {
		return ["stale roadmap orchestration lease remained active — unsafe merge"]
	}
	return []
}

export function auditNonMutatingRoadmapFileAndRoadmapMismatch(
	laneReceipts: LaneExecutionReceipt[],
	agents: SubagentExecutionEnvelope[],
): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		if (lane.lockRequired || lane.roadmapMutationLockRequired) {
			continue
		}
		const agent = agents.find((a) => a.agentId === lane.agentId)
		if (!agent) {
			continue
		}
		const fileWrites = envelopeIndicatesWrites(agent.toolSteps, agent.touchedFiles)
		const roadmapWrites = envelopeIndicatesRoadmapWrites(agent.toolSteps, lane.roadmapWriteSet)
		if (roadmapWrites && !fileWrites) {
			violations.push(`non-mutating lane ${lane.laneId} performed roadmap writes without roadmap mutation claim`)
		}
	}
	return violations
}

export function runRoadmapMergeAudit(options: {
	laneReceipts: LaneExecutionReceipt[]
	laneDag: LaneDAGNode[]
	claimHistory: ClaimHistoryEntry[]
	agents: SubagentExecutionEnvelope[]
	roadmapLinkage?: GovernedRoadmapLinkage
	mergePassed: boolean
	sealed: boolean
}): MergeRoadmapAudit {
	const overlap = auditRoadmapWriteOverlaps(options.laneReceipts, options.laneDag)
	const violations = [
		...overlap.violations,
		...auditRoadmapMutationWithoutClaim(options.laneReceipts, options.claimHistory),
		...auditLockSkippedRoadmapMutation(options.laneReceipts, options.agents),
		...auditNonMutatingRoadmapFileAndRoadmapMismatch(options.laneReceipts, options.agents),
		...auditRoadmapCompletionIntegrity(options.roadmapLinkage, options.mergePassed, options.sealed),
		...auditStaleRoadmapOrchestrationLease(options.roadmapLinkage),
	]

	return {
		safe: violations.length === 0,
		violations,
		overlappingResources: overlap.overlappingResources,
		blockedWriters: overlap.blockedWriters,
	}
}
