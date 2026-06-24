import { createHash, randomUUID } from "node:crypto"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import type {
	AgentRoadmapProjection,
	ExpectedStateTransition,
	LocalRoadmapEvent,
	LocalRoadmapEventType,
	PatchConflictPolicy,
	ProposedWorkspacePatch,
	SwarmRoadmapPlan,
	WorkspacePatchType,
} from "@shared/subagent/roadmapProjection"
import type { RoadmapRuntimeState, TaskItem } from "@/services/roadmap/RoadmapService"
import type { LaneLockIntent } from "./LockNecessity"
import { containLocalRoadmapEvents } from "./RoadmapLocalEventContainment"
import { detectRoadmapMutationFromToolStep } from "./RoadmapMutation"

export function computeRoadmapSnapshotId(state: Pick<RoadmapRuntimeState, "version" | "version_vectors">): string {
	const payload = JSON.stringify({ v: state.version, vv: state.version_vectors ?? {} })
	return `rm-snap-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`
}

export function collectKnownRoadmapItemIds(state: RoadmapRuntimeState): Set<string> {
	const ids = new Set<string>()
	for (const item of [...state.tasks.now.items, ...state.tasks.next.items, ...state.tasks.later.items]) {
		ids.add(item.id)
	}
	for (const id of state.active_window?.current_focus_ids ?? []) {
		ids.add(id)
	}
	return ids
}

function collectTaskItems(state: RoadmapRuntimeState): TaskItem[] {
	return [...state.tasks.now.items, ...state.tasks.next.items, ...state.tasks.later.items]
}

function findProjectedItemIds(state: RoadmapRuntimeState, roadmapItemId?: string, dependsOn: number[] = []): string[] {
	const items = collectTaskItems(state)
	const ids = new Set<string>()

	if (roadmapItemId) {
		const match = items.find((item) => item.id === roadmapItemId || item.title.includes(roadmapItemId))
		if (match) {
			ids.add(match.id)
		} else {
			ids.add(roadmapItemId)
		}
	}

	for (const focusId of state.active_window?.current_focus_ids ?? []) {
		if (!roadmapItemId || focusId === roadmapItemId) {
			ids.add(focusId)
		}
	}

	if (!ids.size && items.length > 0 && dependsOn.length === 0) {
		ids.add(items[0].id)
	}

	return [...ids]
}

export function defaultExpectedTransition(type: WorkspacePatchType): ExpectedStateTransition {
	switch (type) {
		case "mark_complete":
			return { from: "active", to: "completed" }
		case "reopen_item":
			return { from: "completed", to: "active" }
		case "move_lane":
			return { from: "current_lane", to: "target_lane" }
		case "update_dependency":
			return { from: "dependencies", to: "updated_dependencies" }
		case "attach_evidence":
			return { from: "unverified", to: "evidence_attached" }
		case "add_blocked_reason":
			return { from: "unblocked", to: "blocked" }
		case "update_ownership":
			return { from: "unowned", to: "assigned" }
		case "advisory_only":
			return { to: "advisory" }
		default:
			return { to: type }
	}
}

export function defaultPatchFields(
	type: WorkspacePatchType,
	projection: AgentRoadmapProjection,
	overrides?: Partial<ProposedWorkspacePatch>,
): Pick<
	ProposedWorkspacePatch,
	"agentRoadmapId" | "baseWorkspaceSnapshotId" | "expectedTransition" | "conflictPolicy" | "confidence" | "rationale"
> {
	return {
		agentRoadmapId: projection.agentRoadmapId,
		baseWorkspaceSnapshotId: projection.roadmapSnapshotId,
		expectedTransition: defaultExpectedTransition(type),
		conflictPolicy: (overrides?.conflictPolicy ?? "rebase_if_safe") as PatchConflictPolicy,
		confidence: overrides?.confidence ?? (type === "advisory_only" ? 0.5 : 0.8),
		rationale:
			overrides?.rationale ??
			`lane ${projection.index + 1} proposes ${type} for ${overrides?.itemId ?? projection.roadmapItemId ?? "item"}`,
	}
}

export function buildSwarmRoadmapPlan(
	swarmId: string,
	roadmapSnapshotId: string,
	lanes: Array<{ index: number; laneId: string; roadmapItemId?: string }>,
): SwarmRoadmapPlan {
	return {
		swarmRoadmapId: `swarm-rm:${swarmId}`,
		roadmapSnapshotId,
		swarmId,
		laneItemIds: lanes.map((lane) => ({
			index: lane.index,
			laneId: lane.laneId,
			roadmapItemId: lane.roadmapItemId,
		})),
	}
}

export function buildAgentRoadmapProjection(input: {
	swarmId: string
	laneId: string
	agentId: string
	index: number
	workspaceSnapshotId: string
	swarmRoadmapId: string
	intent: LaneLockIntent
	goalSummary?: string
	workspaceState: RoadmapRuntimeState
	dependsOn?: number[]
	executionMode?: LaneExecutionMode
}): AgentRoadmapProjection {
	const dependsOn = input.dependsOn ?? []
	return {
		agentRoadmapId: `agent-rm:${input.swarmId}:${input.index}`,
		roadmapSnapshotId: input.workspaceSnapshotId,
		swarmRoadmapId: input.swarmRoadmapId,
		laneId: input.laneId,
		agentId: input.agentId,
		index: input.index,
		plane: "agent",
		projectedItems: findProjectedItemIds(input.workspaceState, input.intent.roadmapItemId, dependsOn),
		roadmapItemId: input.intent.roadmapItemId,
		dependsOn,
		executionMode: input.executionMode ?? input.intent.executionMode,
		goalSummary: input.goalSummary,
	}
}

const LOCAL_EVENT_PATTERN =
	/\[local_roadmap:(todo_state|progress_note|dependency_observation|completion_confidence|evidence_checklist|blocked_reason)(?::([^:\]]+))?(?::([^\]]+))?\]/gi

const PATCH_PATTERN =
	/\[propose_patch:(mark_complete|move_lane|update_dependency|add_blocked_reason|attach_evidence|update_ownership|suggest_follow_up|advisory_only|reopen_item):([^:\]]+)(?::([^\]]+))?\]/gi

function parsePatchMeta(detail?: string): Partial<ProposedWorkspacePatch> {
	if (!detail?.trim()) {
		return {}
	}
	const meta: Partial<ProposedWorkspacePatch> = { payload: { detail } }
	for (const part of detail.split("|")) {
		const [key, value] = part.split("=").map((s) => s.trim())
		if (!key || !value) {
			continue
		}
		switch (key) {
			case "evidence":
				meta.evidencePointer = value
				break
			case "rationale":
				meta.rationale = value
				break
			case "confidence":
				meta.confidence = Number.parseFloat(value)
				break
			case "policy":
				meta.conflictPolicy = value as PatchConflictPolicy
				break
			case "from":
				meta.expectedTransition = {
					...meta.expectedTransition,
					from: value,
					to: meta.expectedTransition?.to ?? "updated",
				}
				break
			case "to":
				meta.expectedTransition = { from: meta.expectedTransition?.from, to: value }
				break
			default:
				break
		}
	}
	return meta
}

export function parseLocalRoadmapEventsFromPrompt(prompt: string, itemId?: string): LocalRoadmapEvent[] {
	const events: LocalRoadmapEvent[] = []
	const now = Date.now()
	for (const match of prompt.matchAll(LOCAL_EVENT_PATTERN)) {
		events.push({
			type: match[1] as LocalRoadmapEventType,
			itemId: match[2]?.trim() || itemId,
			payload: match[3]?.trim(),
			timestamp: now,
		})
	}
	return events
}

export function parseProposedPatchesFromPrompt(prompt: string, projection: AgentRoadmapProjection): ProposedWorkspacePatch[] {
	const patches: ProposedWorkspacePatch[] = []
	for (const match of prompt.matchAll(PATCH_PATTERN)) {
		const type = match[1] as WorkspacePatchType
		const itemId = match[2].trim()
		const meta = parsePatchMeta(match[3]?.trim())
		const defaults = defaultPatchFields(type, projection, { itemId, ...meta })
		patches.push({
			patchId: randomUUID(),
			laneId: projection.laneId,
			agentId: projection.agentId,
			type,
			itemId,
			advisory: type === "advisory_only",
			evidencePointer: meta.evidencePointer,
			...defaults,
			...meta,
			baseWorkspaceSnapshotId: projection.roadmapSnapshotId,
			baseSnapshotId: projection.roadmapSnapshotId,
		})
	}
	return patches
}

export function mapMutationSignalToPatchType(signal: string): WorkspacePatchType | undefined {
	switch (signal) {
		case "update_completion":
			return "mark_complete"
		case "move_kanban":
			return "move_lane"
		case "change_dependencies":
			return "update_dependency"
		case "write_advisory_to_state":
			return "advisory_only"
		case "mutate_ownership":
			return "update_ownership"
		case "claim_item":
		case "release_item":
		case "mutate_now":
			return "suggest_follow_up"
		default:
			return undefined
	}
}

export function collectRoadmapLaneArtifacts(options: {
	prompt?: string
	projection?: AgentRoadmapProjection
	toolSteps?: Array<{ toolName: string; params?: Record<string, string> }>
	evidencePointer?: string
	evidenceCount?: number
}): {
	localRoadmapEvents: LocalRoadmapEvent[]
	proposedWorkspacePatch: ProposedWorkspacePatch[]
	localEventRejections: string[]
} {
	if (!options.projection) {
		return { localRoadmapEvents: [], proposedWorkspacePatch: [], localEventRejections: [] }
	}

	const rawLocal = parseLocalRoadmapEventsFromPrompt(options.prompt ?? "", options.projection.roadmapItemId)
	const containment = containLocalRoadmapEvents(rawLocal, options.projection, {
		evidencePointer: options.evidencePointer,
		confidence: options.evidenceCount ? 0.85 : undefined,
	})

	const proposedWorkspacePatch = [
		...parseProposedPatchesFromPrompt(options.prompt ?? "", options.projection),
		...containment.convertedPatches,
	]

	for (const step of options.toolSteps ?? []) {
		const detected = detectRoadmapMutationFromToolStep(step.toolName, step.params)
		if (detected.readKeys.length && !detected.writeKeys.length) {
			continue
		}
		for (const signal of detected.signals) {
			const patchType = mapMutationSignalToPatchType(signal)
			if (!patchType) {
				continue
			}
			const itemId = options.projection.roadmapItemId || options.projection.projectedItems[0] || "workspace"
			const defaults = defaultPatchFields(patchType, options.projection, { itemId })
			proposedWorkspacePatch.push({
				patchId: randomUUID(),
				laneId: options.projection.laneId,
				agentId: options.projection.agentId,
				type: patchType,
				itemId,
				advisory: patchType === "advisory_only",
				evidencePointer: options.evidencePointer,
				...defaults,
				payload: step.params?.action ? { action: step.params.action } : undefined,
				baseWorkspaceSnapshotId: options.projection.roadmapSnapshotId,
				baseSnapshotId: options.projection.roadmapSnapshotId,
			})
		}
	}

	return {
		localRoadmapEvents: containment.containedEvents,
		proposedWorkspacePatch,
		localEventRejections: containment.rejectedLocalEvents.map((r) => r.reason),
	}
}

export function agentAttemptedDirectWorkspaceRoadmapMutation(options: {
	toolSteps?: Array<{ toolName: string; params?: Record<string, string> }>
	proposedPatches?: ProposedWorkspacePatch[]
}): boolean {
	const hasDirectWrite = Boolean(
		options.toolSteps?.some((step) => detectRoadmapMutationFromToolStep(step.toolName, step.params).writeKeys.length > 0),
	)
	if (!hasDirectWrite) {
		return false
	}
	return (options.proposedPatches?.length ?? 0) === 0
}

export function localEventsImplyWorkspaceMutation(events: LocalRoadmapEvent[]): boolean {
	return events.some((e) => e.containment === "rejected")
}
