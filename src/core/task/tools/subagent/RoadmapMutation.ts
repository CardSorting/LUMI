import { targetsRoadmapFile } from "@/services/roadmap/RoadmapNativeBridge"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { LaneLockIntent } from "./LockNecessity"

export const ROADMAP_RESOURCE_PREFIX = "roadmap:" as const

export type RoadmapMutationSignal =
	| "move_kanban"
	| "claim_item"
	| "release_item"
	| "update_completion"
	| "mutate_now"
	| "change_dependencies"
	| "write_advisory_to_state"
	| "mutate_ownership"

export function buildRoadmapWorkspaceKey(): string {
	return "roadmap:workspace"
}

export function buildRoadmapItemKey(itemId: string): string {
	return `roadmap:item:${itemId}`
}

export function buildRoadmapLaneKey(laneId: string): string {
	return `roadmap:lane:${laneId}`
}

export function buildRoadmapNowKey(): string {
	return "roadmap:now"
}

export function buildRoadmapCompletionKey(taskId: string): string {
	return `roadmap:completion:${taskId}`
}

export function isRoadmapResourceKey(resourceKey: string): boolean {
	return resourceKey.startsWith(ROADMAP_RESOURCE_PREFIX)
}

export function normalizeRoadmapResourceKey(raw: string): string {
	const trimmed = raw.trim()
	if (trimmed.startsWith(ROADMAP_RESOURCE_PREFIX)) {
		return trimmed
	}
	if (trimmed.startsWith("item:")) {
		return buildRoadmapItemKey(trimmed.slice(5))
	}
	if (trimmed === "now" || trimmed === "workspace") {
		return trimmed === "now" ? buildRoadmapNowKey() : buildRoadmapWorkspaceKey()
	}
	return buildRoadmapItemKey(trimmed)
}

export function parseRoadmapReadSetFromPrompt(prompt: string): string[] {
	const match = prompt.match(/\[roadmap_read_set:([^\]]+)\]/i)
	if (!match) {
		return []
	}
	return match[1]
		.split(",")
		.map((part) => normalizeRoadmapResourceKey(part.trim()))
		.filter(Boolean)
}

export function parseRoadmapWriteSetFromPrompt(prompt: string): string[] {
	const match = prompt.match(/\[roadmap_write_set:([^\]]+)\]/i)
	if (!match) {
		return []
	}
	return match[1]
		.split(",")
		.map((part) => normalizeRoadmapResourceKey(part.trim()))
		.filter(Boolean)
}

export function parseRoadmapMutationSignalsFromPrompt(prompt: string): RoadmapMutationSignal[] {
	const signals: RoadmapMutationSignal[] = []
	if (/\[roadmap_moves_kanban\]/i.test(prompt) || /\[mutates_kanban\]/i.test(prompt)) {
		signals.push("move_kanban")
	}
	if (/\[claims_roadmap_item\]/i.test(prompt) || /\[roadmap_claims_item\]/i.test(prompt)) {
		signals.push("claim_item")
	}
	if (/\[releases_roadmap_item\]/i.test(prompt)) {
		signals.push("release_item")
	}
	if (/\[mutates_roadmap_completion\]/i.test(prompt) || /\[updates_completion_state\]/i.test(prompt)) {
		signals.push("update_completion")
	}
	if (/\[mutates_roadmap_now\]/i.test(prompt) || /\[claims_roadmap_now\]/i.test(prompt)) {
		signals.push("mutate_now")
	}
	if (/\[mutates_roadmap_dependencies\]/i.test(prompt) || /\[changes_dependencies\]/i.test(prompt)) {
		signals.push("change_dependencies")
	}
	if (/\[writes_roadmap_advisory\]/i.test(prompt)) {
		signals.push("write_advisory_to_state")
	}
	if (/\[mutates_roadmap_ownership\]/i.test(prompt)) {
		signals.push("mutate_ownership")
	}
	return signals
}

export function roadmapSignalsToResourceKeys(
	signals: RoadmapMutationSignal[],
	roadmapItemId?: string,
	taskId?: string,
	laneId?: string,
): string[] {
	const keys = new Set<string>()
	for (const signal of signals) {
		switch (signal) {
			case "mutate_now":
				keys.add(buildRoadmapNowKey())
				break
			case "claim_item":
			case "release_item":
				if (roadmapItemId) {
					keys.add(buildRoadmapItemKey(roadmapItemId))
				}
				keys.add(buildRoadmapNowKey())
				break
			case "update_completion":
				if (taskId) {
					keys.add(buildRoadmapCompletionKey(taskId))
				}
				keys.add(buildRoadmapWorkspaceKey())
				break
			case "move_kanban":
			case "change_dependencies":
			case "write_advisory_to_state":
			case "mutate_ownership":
				keys.add(buildRoadmapWorkspaceKey())
				break
			default:
				break
		}
	}
	if (laneId && signals.includes("mutate_ownership")) {
		keys.add(buildRoadmapLaneKey(laneId))
	}
	return [...keys]
}

export function resolveRoadmapResourceKeys(intent: {
	roadmapReadSet?: string[]
	roadmapWriteSet?: string[]
	roadmapItemId?: string
	mutatesRoadmap?: boolean
	roadmapMutationSignals?: RoadmapMutationSignal[]
	taskId?: string
	laneId?: string
}): string[] {
	const keys = new Set<string>()
	for (const key of intent.roadmapWriteSet ?? []) {
		keys.add(normalizeRoadmapResourceKey(key))
	}
	if (intent.roadmapItemId && (intent.mutatesRoadmap || (intent.roadmapMutationSignals?.length ?? 0) > 0)) {
		keys.add(buildRoadmapItemKey(intent.roadmapItemId))
	}
	if (intent.mutatesRoadmap) {
		keys.add(buildRoadmapWorkspaceKey())
	}
	for (const key of roadmapSignalsToResourceKeys(
		intent.roadmapMutationSignals ?? [],
		intent.roadmapItemId,
		intent.taskId,
		intent.laneId,
	)) {
		keys.add(key)
	}
	return [...keys]
}

export function classifyRoadmapWriteIntent(
	prompt: string,
	params?: Record<string, string | undefined>,
	index?: number,
): Pick<
	LaneLockIntent,
	"roadmapReadSet" | "roadmapWriteSet" | "roadmapMutationSignals" | "roadmapResourceKeys" | "mutatesRoadmap"
> {
	const laneKey = index !== undefined ? `roadmap_write_set_${index + 1}` : undefined
	const readLaneKey = index !== undefined ? `roadmap_read_set_${index + 1}` : undefined
	const roadmapReadSet =
		(readLaneKey && params?.[readLaneKey]?.split(",").map((p) => normalizeRoadmapResourceKey(p.trim()))) ||
		parseRoadmapReadSetFromPrompt(prompt)
	const roadmapWriteSet =
		(laneKey &&
			params?.[laneKey]
				?.split(",")
				.map((p) => normalizeRoadmapResourceKey(p.trim()))
				.filter(Boolean)) ||
		parseRoadmapWriteSetFromPrompt(prompt)
	const roadmapMutationSignals = parseRoadmapMutationSignalsFromPrompt(prompt)
	const mutatesRoadmap = /\[mutates_roadmap\]/i.test(prompt) || roadmapWriteSet.length > 0 || roadmapMutationSignals.length > 0
	const roadmapItemId =
		params?.[`roadmap_item_${index !== undefined ? index + 1 : 1}`]?.trim() ||
		prompt.match(/\[roadmap_item:([^\]]+)\]/i)?.[1]?.trim()
	const roadmapResourceKeys = resolveRoadmapResourceKeys({
		roadmapWriteSet,
		roadmapItemId,
		mutatesRoadmap,
		roadmapMutationSignals,
	})

	return {
		roadmapReadSet: roadmapReadSet.length ? roadmapReadSet : undefined,
		roadmapWriteSet: roadmapWriteSet.length ? roadmapWriteSet : undefined,
		roadmapMutationSignals: roadmapMutationSignals.length ? roadmapMutationSignals : undefined,
		roadmapResourceKeys: roadmapResourceKeys.length ? roadmapResourceKeys : undefined,
		mutatesRoadmap,
	}
}

const ROADMAP_READ_ACTIONS = new Set(["validate", "status", "read", "explain-gate", "explain_gate", "doctor"])

export function detectRoadmapMutationFromToolStep(
	toolName: string,
	params?: Record<string, string>,
): { readKeys: string[]; writeKeys: string[]; signals: RoadmapMutationSignal[] } {
	const name = (toolName || "").trim().toLowerCase()
	const action = (params?.action || "").trim().toLowerCase()
	const signals: RoadmapMutationSignal[] = []

	if (name === DietCodeDefaultTool.ROADMAP || name === DietCodeDefaultTool.ROADMAP_CHECKPOINT) {
		if (ROADMAP_READ_ACTIONS.has(action)) {
			return { readKeys: [buildRoadmapWorkspaceKey()], writeKeys: [], signals }
		}
		if (action === "checkpoint" || action === "write" || action === "update" || !action) {
			signals.push("write_advisory_to_state")
			return { readKeys: [], writeKeys: [buildRoadmapWorkspaceKey()], signals }
		}
	}

	if (targetsRoadmapFile(name, params as Record<string, unknown>)) {
		signals.push("move_kanban")
		return { readKeys: [], writeKeys: [buildRoadmapWorkspaceKey()], signals }
	}

	return { readKeys: [], writeKeys: [], signals }
}

export function envelopeIndicatesRoadmapWrites(
	toolSteps?: Array<{ toolName: string; params?: Record<string, string> }>,
	declaredWriteSet?: string[],
): boolean {
	if (declaredWriteSet?.length) {
		return true
	}
	return Boolean(toolSteps?.some((step) => detectRoadmapMutationFromToolStep(step.toolName, step.params).writeKeys.length > 0))
}

export function splitRoadmapReadWriteSets(options: {
	intentReadSet?: string[]
	intentWriteSet?: string[]
	toolSteps?: Array<{ toolName: string; params?: Record<string, string> }>
}): { roadmapReadSet: string[]; roadmapWriteSet: string[] } {
	const read = new Set(options.intentReadSet ?? [])
	const write = new Set(options.intentWriteSet ?? [])

	for (const step of options.toolSteps ?? []) {
		const detected = detectRoadmapMutationFromToolStep(step.toolName, step.params)
		for (const key of detected.readKeys) {
			read.add(key)
		}
		for (const key of detected.writeKeys) {
			write.add(key)
		}
	}

	return { roadmapReadSet: [...read], roadmapWriteSet: [...write] }
}

export function requiresRoadmapMutationLock(_intent: LaneLockIntent): boolean {
	// Per-agent projection model: lanes mutate private agentRoadmap only.
	// Workspace commits are coordinator-owned after patch reconciliation.
	return false
}

export function declaresDirectWorkspaceRoadmapMutation(intent: LaneLockIntent): boolean {
	return Boolean(
		intent.mutatesRoadmap &&
			(intent.roadmapWriteSet?.some((key) => key.startsWith("roadmap:")) ||
				intent.roadmapMutationSignals?.some((s) => s !== "write_advisory_to_state")),
	)
}
