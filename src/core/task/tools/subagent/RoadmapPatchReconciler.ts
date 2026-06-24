import type { LaneDAGNode, LaneExecutionReceipt } from "@shared/subagent/governedExecution"
import type {
	PatchRebaseResult,
	ProposedWorkspacePatch,
	RejectedWorkspacePatch,
	RoadmapPatchReconciliation,
	WorkspacePatchType,
} from "@shared/subagent/roadmapProjection"
import { normalizePatchSnapshotFields, validatePatchQuality } from "./RoadmapPatchQualityGate"

const REBASE_SAFE_TYPES = new Set<WorkspacePatchType>([
	"attach_evidence",
	"add_blocked_reason",
	"suggest_follow_up",
	"advisory_only",
])

const CONFLICTING_TYPES = new Set<WorkspacePatchType>(["mark_complete", "move_lane", "update_dependency", "update_ownership"])

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

function patchTargetsSameItem(a: ProposedWorkspacePatch, b: ProposedWorkspacePatch): boolean {
	return a.itemId === b.itemId
}

function snapshotId(patch: ProposedWorkspacePatch): string {
	return patch.baseWorkspaceSnapshotId || patch.baseSnapshotId || ""
}

function patchesAreCompatible(a: ProposedWorkspacePatch, b: ProposedWorkspacePatch): boolean {
	if (!patchTargetsSameItem(a, b)) {
		return true
	}
	if (a.advisory || b.advisory) {
		return true
	}
	if (a.type === b.type && a.type === "attach_evidence") {
		return true
	}
	if (a.type === b.type && CONFLICTING_TYPES.has(a.type)) {
		return false
	}
	const compatiblePairs = new Set([
		"attach_evidence|mark_complete",
		"attach_evidence|attach_evidence",
		"add_blocked_reason|mark_complete",
		"update_dependency|move_lane",
	])
	const key = [a.type, b.type].sort().join("|")
	return compatiblePairs.has(key)
}

export function attemptPatchRebase(
	patch: ProposedWorkspacePatch,
	workspaceSnapshotIdAtAdmit: string | undefined,
	currentWorkspaceSnapshotId: string | undefined,
): PatchRebaseResult {
	const base = snapshotId(patch)
	const result: PatchRebaseResult = {
		patchId: patch.patchId,
		agentRoadmapId: patch.agentRoadmapId,
		fromSnapshotId: base,
		outcome: "not_needed",
	}

	if (!currentWorkspaceSnapshotId || base === currentWorkspaceSnapshotId) {
		return result
	}

	if (base === workspaceSnapshotIdAtAdmit && currentWorkspaceSnapshotId !== workspaceSnapshotIdAtAdmit) {
		if (REBASE_SAFE_TYPES.has(patch.type)) {
			return {
				...result,
				outcome: "rebased",
				toSnapshotId: currentWorkspaceSnapshotId,
				reason: "safe rebase onto current workspace snapshot",
			}
		}
		if (CONFLICTING_TYPES.has(patch.type)) {
			return {
				...result,
				outcome: "stale_conflict",
				toSnapshotId: currentWorkspaceSnapshotId,
				reason: "stale conflicting patch cannot rebase",
			}
		}
	}

	if (patch.conflictPolicy === "require_explicit_reopen" && patch.type !== "reopen_item") {
		return {
			...result,
			outcome: "rejected",
			reason: "explicit reopen policy required",
		}
	}

	return {
		...result,
		outcome: "stale_conflict",
		toSnapshotId: currentWorkspaceSnapshotId,
		reason: "stale roadmap snapshot — rebase not permitted",
	}
}

export function runRoadmapPatchReconciliation(options: {
	laneReceipts: LaneExecutionReceipt[]
	laneDag: LaneDAGNode[]
	workspaceSnapshotIdAtAdmit?: string
	currentWorkspaceSnapshotId?: string
	mergePassed: boolean
	knownItemIds?: Set<string>
	completedItemIds?: Set<string>
}): RoadmapPatchReconciliation {
	const violations: string[] = []
	const rejectedPatches: RejectedWorkspacePatch[] = []
	const staleProjections: string[] = []
	const rebaseResults: PatchRebaseResult[] = []
	const allPatches: ProposedWorkspacePatch[] = []

	const knownItemIds = options.knownItemIds ?? new Set<string>()
	for (const lane of options.laneReceipts) {
		for (const itemId of lane.projectedItems ?? []) {
			knownItemIds.add(itemId)
		}
		if (lane.roadmapItemId) {
			knownItemIds.add(lane.roadmapItemId)
		}
	}

	for (const lane of options.laneReceipts) {
		if (
			lane.agentRoadmapId &&
			options.currentWorkspaceSnapshotId &&
			lane.roadmapSnapshotId &&
			options.workspaceSnapshotIdAtAdmit &&
			lane.roadmapSnapshotId !== options.workspaceSnapshotIdAtAdmit &&
			lane.roadmapSnapshotId !== options.currentWorkspaceSnapshotId
		) {
			staleProjections.push(lane.agentRoadmapId)
		}
		for (const patch of lane.proposedWorkspacePatch ?? []) {
			allPatches.push(normalizePatchSnapshotFields(patch))
		}
	}

	const acceptedPatches: ProposedWorkspacePatch[] = []

	for (const patch of allPatches) {
		const lane = options.laneReceipts.find((l) => l.laneId === patch.laneId)
		if (!lane) {
			rejectedPatches.push({ patch, reason: "lane receipt missing" })
			continue
		}

		const quality = validatePatchQuality(patch, {
			knownItemIds,
			projectedItemIds: lane.projectedItems,
			evidenceCount: lane.evidenceCount,
			transcriptArtifactPath: lane.transcriptArtifactPath,
		})
		if (!quality.valid && !patch.advisory && patch.type !== "advisory_only") {
			rejectedPatches.push({ patch, reason: quality.reasons.join("; ") })
			continue
		}

		const rebase = attemptPatchRebase(patch, options.workspaceSnapshotIdAtAdmit, options.currentWorkspaceSnapshotId)
		rebaseResults.push(rebase)
		if (rebase.outcome === "stale_conflict" || rebase.outcome === "rejected") {
			rejectedPatches.push({ patch, reason: rebase.reason ?? "stale projection" })
			if (lane.agentRoadmapId) {
				staleProjections.push(lane.agentRoadmapId)
			}
			continue
		}
		const rebasedPatch =
			rebase.outcome === "rebased" && rebase.toSnapshotId
				? { ...patch, baseWorkspaceSnapshotId: rebase.toSnapshotId, baseSnapshotId: rebase.toSnapshotId }
				: patch

		if (lane.status === "failed" || lane.status === "collision_rejected") {
			if (rebasedPatch.type === "mark_complete" && !rebasedPatch.advisory) {
				rejectedPatches.push({ patch: rebasedPatch, reason: "failed lane cannot mark roadmap complete" })
				continue
			}
		}

		if (rebasedPatch.advisory || rebasedPatch.type === "advisory_only") {
			acceptedPatches.push(rebasedPatch)
			continue
		}

		if (!options.mergePassed) {
			rejectedPatches.push({ patch: rebasedPatch, reason: "merge gate did not pass" })
			continue
		}

		if (options.completedItemIds?.has(rebasedPatch.itemId) && rebasedPatch.type !== "reopen_item") {
			rejectedPatches.push({
				patch: rebasedPatch,
				reason: "patch targets completed item — explicit reopen_item policy required",
			})
			continue
		}

		acceptedPatches.push(rebasedPatch)
	}

	for (let i = 0; i < acceptedPatches.length; i++) {
		for (let j = i + 1; j < acceptedPatches.length; j++) {
			const a = acceptedPatches[i]
			const b = acceptedPatches[j]
			if (!patchTargetsSameItem(a, b)) {
				continue
			}
			if (a.advisory || b.advisory) {
				continue
			}
			const laneA = options.laneReceipts.find((l) => l.laneId === a.laneId)
			const laneB = options.laneReceipts.find((l) => l.laneId === b.laneId)
			if (!laneA || !laneB) {
				continue
			}
			if (!isOverlapAllowedByDag(laneA.index, laneB.index, options.laneDag) && !patchesAreCompatible(a, b)) {
				violations.push(`conflicting workspace patches on '${a.itemId}': ${a.agentId}, ${b.agentId}`)
				rejectedPatches.push({ patch: a, reason: `incompatible parallel patch from ${b.agentId}` })
				rejectedPatches.push({ patch: b, reason: `incompatible parallel patch from ${a.agentId}` })
			}
		}
	}

	const rejectedIds = new Set(rejectedPatches.map((entry) => entry.patch.patchId))
	const finalAccepted = acceptedPatches.filter((patch) => !rejectedIds.has(patch.patchId))

	const actionableAccepted = finalAccepted.filter((p) => !p.advisory && p.type !== "advisory_only")
	const commitStatus = (() => {
		if (!options.mergePassed) {
			return "blocked" as const
		}
		if (!actionableAccepted.length) {
			return finalAccepted.length ? "advisory_only" : "skipped"
		}
		if (violations.length) {
			return "blocked"
		}
		return "pending"
	})()

	return {
		passed: violations.length === 0 && rejectedPatches.filter((r) => !r.patch.advisory).length === 0,
		violations,
		acceptedPatches: finalAccepted,
		rejectedPatches,
		staleProjections: [...new Set(staleProjections)],
		rebaseResults,
		commitStatus: violations.length ? "blocked" : commitStatus,
		workspaceSnapshotId: options.workspaceSnapshotIdAtAdmit,
		currentWorkspaceSnapshotId: options.currentWorkspaceSnapshotId,
	}
}

export function auditDirectWorkspaceRoadmapMutation(laneReceipts: LaneExecutionReceipt[]): string[] {
	const violations: string[] = []
	for (const lane of laneReceipts) {
		if (lane.directWorkspaceRoadmapMutation) {
			violations.push(`agent ${lane.agentId} cannot directly mutate workspace roadmap — emit proposedWorkspacePatch`)
		}
		if (lane.localEventContainmentViolations?.length) {
			violations.push(
				...lane.localEventContainmentViolations.map(
					(reason) => `agent ${lane.agentId} smuggled authoritative mutation via local event: ${reason}`,
				),
			)
		}
	}
	return violations
}
