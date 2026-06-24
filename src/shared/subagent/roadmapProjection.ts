import type { LaneExecutionMode } from "./governedExecution"

export type RoadmapPlane = "workspace" | "swarm" | "agent"

export type WorkspacePatchType =
	| "mark_complete"
	| "move_lane"
	| "update_dependency"
	| "add_blocked_reason"
	| "attach_evidence"
	| "update_ownership"
	| "suggest_follow_up"
	| "advisory_only"
	| "reopen_item"

export type LocalRoadmapEventType =
	| "todo_state"
	| "progress_note"
	| "dependency_observation"
	| "completion_confidence"
	| "evidence_checklist"
	| "blocked_reason"

export type LocalEventContainment = "accepted" | "rejected" | "converted_to_patch"

export type PatchConflictPolicy = "fail_on_conflict" | "rebase_if_safe" | "require_explicit_reopen"

export type PatchRebaseOutcome = "not_needed" | "rebased" | "stale_conflict" | "rejected"

export interface ExpectedStateTransition {
	from?: string
	to: string
}

export interface LocalRoadmapEvent {
	type: LocalRoadmapEventType
	itemId?: string
	payload?: string
	timestamp: number
	containment?: LocalEventContainment
	rejectionReason?: string
}

export interface ProposedWorkspacePatch {
	patchId: string
	agentRoadmapId: string
	laneId: string
	agentId: string
	type: WorkspacePatchType
	itemId: string
	advisory?: boolean
	/** @deprecated use baseWorkspaceSnapshotId */
	baseSnapshotId?: string
	baseWorkspaceSnapshotId: string
	evidencePointer?: string
	confidence?: number
	rationale?: string
	expectedTransition?: ExpectedStateTransition
	conflictPolicy?: PatchConflictPolicy
	payload?: Record<string, string | number | boolean | undefined>
}

export interface AgentRoadmapProjection {
	agentRoadmapId: string
	roadmapSnapshotId: string
	swarmRoadmapId: string
	laneId: string
	agentId: string
	index: number
	plane: "agent"
	projectedItems: string[]
	roadmapItemId?: string
	dependsOn: number[]
	executionMode: LaneExecutionMode
	goalSummary?: string
}

export interface SwarmRoadmapPlan {
	swarmRoadmapId: string
	roadmapSnapshotId: string
	swarmId: string
	laneItemIds: Array<{ index: number; laneId: string; roadmapItemId?: string }>
}

export interface RejectedWorkspacePatch {
	patch: ProposedWorkspacePatch
	reason: string
}

export type RoadmapCommitStatus = "pending" | "committed" | "blocked" | "advisory_only" | "skipped"

export interface PatchRebaseResult {
	patchId: string
	agentRoadmapId?: string
	outcome: PatchRebaseOutcome
	fromSnapshotId: string
	toSnapshotId?: string
	reason?: string
}

export interface RoadmapPatchReconciliation {
	passed: boolean
	violations: string[]
	acceptedPatches: ProposedWorkspacePatch[]
	rejectedPatches: RejectedWorkspacePatch[]
	staleProjections: string[]
	rebaseResults: PatchRebaseResult[]
	commitStatus: RoadmapCommitStatus
	workspaceSnapshotId?: string
	currentWorkspaceSnapshotId?: string
}

export interface RoadmapWorkspaceCommitResult {
	committed: boolean
	commitStatus: RoadmapCommitStatus
	workspaceLockAcquired?: boolean
	appliedPatchIds: string[]
	error?: string
	blockReason?: string
}
