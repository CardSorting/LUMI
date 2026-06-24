import type { LockClaim } from "@shared/governance/lockTypes"
import type { RoadmapCompletionUpdatePolicy } from "@shared/subagent/governedExecution"
import type { RoadmapPatchReconciliation, RoadmapWorkspaceCommitResult } from "@shared/subagent/roadmapProjection"
import type { LockAuthority } from "@/core/governance/LockAuthority"
import { releaseGovernedLock } from "@/core/governance/LockAuthority"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { buildRoadmapWorkspaceKey } from "./RoadmapMutation"

export function canCoordinatorCommitWorkspaceRoadmap(options: {
	mergePassed: boolean
	reconciliation: RoadmapPatchReconciliation
	integrityValid: boolean
	sealed: boolean
	completionPolicy: RoadmapCompletionUpdatePolicy
	roadmapEnabled: boolean
}): { allowed: boolean; reason?: string } {
	if (!options.roadmapEnabled) {
		return { allowed: false, reason: "roadmap disabled" }
	}
	if (!options.sealed) {
		return { allowed: false, reason: "receipt not sealed" }
	}
	if (!options.mergePassed) {
		return { allowed: false, reason: "merge gate did not pass" }
	}
	if (!options.integrityValid) {
		return { allowed: false, reason: "receipt integrity invalid" }
	}
	if (!options.reconciliation.passed) {
		return { allowed: false, reason: "roadmap patch reconciliation failed" }
	}
	if (options.reconciliation.commitStatus === "blocked") {
		return { allowed: false, reason: "roadmap commit status blocked" }
	}
	const actionable = options.reconciliation.acceptedPatches.filter((patch) => !patch.advisory && patch.type !== "advisory_only")
	if (!actionable.length) {
		return { allowed: false, reason: "no actionable patches to commit" }
	}
	if (options.completionPolicy === "advisory_only" && actionable.some((p) => p.type === "mark_complete")) {
		return { allowed: false, reason: "completion policy advisory_only blocks mark_complete commit" }
	}
	return { allowed: true }
}

export async function commitWorkspaceRoadmapPatches(options: {
	workspace: string
	coordinatorId: string
	reconciliation: RoadmapPatchReconciliation
	lockAuthority: LockAuthority
	roadmapEnabled: boolean
	mergePassed: boolean
	integrityValid: boolean
	sealed: boolean
	completionPolicy: RoadmapCompletionUpdatePolicy
}): Promise<RoadmapWorkspaceCommitResult> {
	const actionable = options.reconciliation.acceptedPatches.filter((patch) => !patch.advisory && patch.type !== "advisory_only")

	const gate = canCoordinatorCommitWorkspaceRoadmap({
		mergePassed: options.mergePassed,
		reconciliation: options.reconciliation,
		integrityValid: options.integrityValid,
		sealed: options.sealed,
		completionPolicy: options.completionPolicy,
		roadmapEnabled: options.roadmapEnabled,
	})

	if (!gate.allowed) {
		return {
			committed: false,
			commitStatus: options.roadmapEnabled ? "blocked" : "skipped",
			appliedPatchIds: [],
			blockReason: gate.reason,
		}
	}

	const resourceKey = buildRoadmapWorkspaceKey()
	let claim: LockClaim | undefined

	const acquireResult = await options.lockAuthority.acquire(resourceKey, options.coordinatorId, {
		workspace: options.workspace,
		roadmapLeaseTaskId: `coordinator-commit-${Date.now()}`,
		timeoutMs: 60_000,
		roadmapEnabled: options.roadmapEnabled,
		crossProcess: true,
		requireDurability: true,
	})

	if (!acquireResult.ok) {
		return {
			committed: false,
			commitStatus: "blocked",
			workspaceLockAcquired: false,
			appliedPatchIds: [],
			error: acquireResult.error,
			blockReason: "coordinator failed to acquire roadmap:workspace lock",
		}
	}

	claim = acquireResult.claim

	try {
		const runtimeState = await RoadmapService.getInstance().getOrHydrateRuntimeState(options.workspace)
		const appliedPatchIds: string[] = []

		for (const patch of actionable) {
			appliedPatchIds.push(patch.patchId)
			switch (patch.type) {
				case "mark_complete": {
					const lists = [runtimeState.tasks.now, runtimeState.tasks.next, runtimeState.tasks.later]
					for (const list of lists) {
						const idx = list.items.findIndex((item) => item.id === patch.itemId)
						if (idx >= 0) {
							list.items.splice(idx, 1)
						}
					}
					break
				}
				case "reopen_item": {
					const exists = [
						...runtimeState.tasks.now.items,
						...runtimeState.tasks.next.items,
						...runtimeState.tasks.later.items,
					].some((item) => item.id === patch.itemId)
					if (!exists) {
						runtimeState.tasks.next.items.push({
							id: patch.itemId,
							title: String(patch.payload?.title ?? patch.itemId),
							body: String(patch.rationale ?? ""),
						})
					}
					break
				}
				case "move_lane": {
					const targetLane = String(patch.payload?.targetLane ?? "next")
					const lists = {
						now: runtimeState.tasks.now,
						next: runtimeState.tasks.next,
						later: runtimeState.tasks.later,
					}
					let moved: (typeof runtimeState.tasks.now.items)[0] | undefined
					for (const list of Object.values(lists)) {
						const idx = list.items.findIndex((item) => item.id === patch.itemId)
						if (idx >= 0) {
							moved = list.items.splice(idx, 1)[0]
							break
						}
					}
					if (moved && targetLane in lists) {
						lists[targetLane as keyof typeof lists].items.push(moved)
					}
					break
				}
				case "add_blocked_reason":
					runtimeState.decision_log =
						`${runtimeState.decision_log}\n[blocked:${patch.itemId}] ${patch.payload?.detail ?? patch.rationale ?? ""}`.trim()
					break
				case "attach_evidence":
					if (!runtimeState.memory) {
						runtimeState.memory = { continuation_anchors: {} }
					}
					runtimeState.memory.continuation_anchors[`evidence:${patch.itemId}`] = String(
						patch.evidencePointer ?? patch.payload?.detail ?? patch.patchId,
					)
					break
				case "update_dependency":
				case "update_ownership":
				case "suggest_follow_up":
					runtimeState.decision_log =
						`${runtimeState.decision_log}\n[${patch.type}:${patch.itemId}] ${patch.rationale ?? patch.payload?.detail ?? ""}`.trim()
					break
				default:
					break
			}
		}

		runtimeState.version = (runtimeState.version ?? 0) + 1
		if (!runtimeState.version_vectors) {
			runtimeState.version_vectors = {}
		}
		runtimeState.version_vectors.workspace = (runtimeState.version_vectors.workspace ?? 0) + 1

		await RoadmapService.getInstance().writeState(options.workspace, { runtime_state: runtimeState })

		return {
			committed: true,
			commitStatus: "committed",
			workspaceLockAcquired: true,
			appliedPatchIds,
		}
	} catch (error) {
		return {
			committed: false,
			commitStatus: "blocked",
			workspaceLockAcquired: true,
			appliedPatchIds: [],
			error: error instanceof Error ? error.message : String(error),
			blockReason: "workspace commit failed",
		}
	} finally {
		if (claim) {
			await releaseGovernedLock(options.lockAuthority, claim, options.workspace)
		}
	}
}
