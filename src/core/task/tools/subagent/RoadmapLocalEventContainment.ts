import { randomUUID } from "node:crypto"
import type {
	AgentRoadmapProjection,
	LocalRoadmapEvent,
	ProposedWorkspacePatch,
	WorkspacePatchType,
} from "@shared/subagent/roadmapProjection"

const MUTATION_PAYLOAD_PATTERNS: Array<{ pattern: RegExp; impliedType: WorkspacePatchType; reason: string }> = [
	{ pattern: /\b(mark.?complete|completed?|done)\b/i, impliedType: "mark_complete", reason: "implies workspace completion" },
	{ pattern: /\b(move.?to.?now|claim.?now|now.?item)\b/i, impliedType: "move_lane", reason: "implies Now claim" },
	{ pattern: /\b(move.?to.?(next|later|doing))\b/i, impliedType: "move_lane", reason: "implies kanban lane move" },
	{
		pattern: /\b(update.?depend|depends?.?on|dependency.?graph)\b/i,
		impliedType: "update_dependency",
		reason: "implies dependency change",
	},
	{ pattern: /\b(assign.?owner|ownership|owner:)\b/i, impliedType: "update_ownership", reason: "implies ownership mutation" },
]

export interface LocalEventContainmentResult {
	containedEvents: LocalRoadmapEvent[]
	convertedPatches: ProposedWorkspacePatch[]
	rejectedLocalEvents: Array<{ event: LocalRoadmapEvent; reason: string }>
}

function payloadImpliesMutation(payload?: string): (typeof MUTATION_PAYLOAD_PATTERNS)[0] | undefined {
	if (!payload?.trim()) {
		return undefined
	}
	return MUTATION_PAYLOAD_PATTERNS.find((entry) => entry.pattern.test(payload))
}

export function containLocalRoadmapEvents(
	events: LocalRoadmapEvent[],
	projection: AgentRoadmapProjection,
	options?: { evidencePointer?: string; confidence?: number },
): LocalEventContainmentResult {
	const containedEvents: LocalRoadmapEvent[] = []
	const convertedPatches: ProposedWorkspacePatch[] = []
	const rejectedLocalEvents: LocalEventContainmentResult["rejectedLocalEvents"] = []

	for (const event of events) {
		if (event.type === "dependency_observation") {
			const mutation = payloadImpliesMutation(event.payload)
			if (mutation) {
				convertedPatches.push(
					buildConvertedPatch(projection, event, mutation.impliedType, options, `converted: ${mutation.reason}`),
				)
				containedEvents.push({
					...event,
					containment: "converted_to_patch",
					rejectionReason: mutation.reason,
				})
				continue
			}
		}

		if (event.type === "completion_confidence" && (event.payload?.includes("complete") || Number(event.payload) >= 0.9)) {
			convertedPatches.push(
				buildConvertedPatch(projection, event, "mark_complete", options, "high completion confidence requires patch"),
			)
			containedEvents.push({
				...event,
				containment: "converted_to_patch",
				rejectionReason: "completion confidence implies authoritative mutation",
			})
			continue
		}

		const mutation = payloadImpliesMutation(event.payload)
		if (mutation && event.type !== "progress_note" && event.type !== "blocked_reason") {
			rejectedLocalEvents.push({ event, reason: `local event ${mutation.reason}` })
			containedEvents.push({
				...event,
				containment: "rejected",
				rejectionReason: mutation.reason,
			})
			continue
		}

		containedEvents.push({ ...event, containment: "accepted" })
	}

	return { containedEvents, convertedPatches, rejectedLocalEvents }
}

function buildConvertedPatch(
	projection: AgentRoadmapProjection,
	event: LocalRoadmapEvent,
	type: WorkspacePatchType,
	options: { evidencePointer?: string; confidence?: number } | undefined,
	rationale: string,
): ProposedWorkspacePatch {
	const itemId = event.itemId || projection.roadmapItemId || projection.projectedItems[0] || "workspace"
	return {
		patchId: randomUUID(),
		agentRoadmapId: projection.agentRoadmapId,
		laneId: projection.laneId,
		agentId: projection.agentId,
		type,
		itemId,
		baseWorkspaceSnapshotId: projection.roadmapSnapshotId,
		baseSnapshotId: projection.roadmapSnapshotId,
		evidencePointer: options?.evidencePointer,
		confidence: options?.confidence ?? 0.7,
		rationale,
		expectedTransition: defaultExpectedTransition(type),
		conflictPolicy: "rebase_if_safe",
		payload: event.payload ? { detail: event.payload } : undefined,
		advisory: type === "advisory_only",
	}
}

function defaultExpectedTransition(type: WorkspacePatchType) {
	switch (type) {
		case "mark_complete":
			return { from: "active", to: "completed" }
		case "move_lane":
			return { from: "current_lane", to: "target_lane" }
		case "update_dependency":
			return { from: "dependencies", to: "updated_dependencies" }
		case "update_ownership":
			return { from: "unowned", to: "assigned" }
		default:
			return { to: type }
	}
}
