import type { LaneExecutionMode } from "@shared/subagent/governedExecution"

export interface LaneLockIntent {
	executionMode: LaneExecutionMode
	readSet?: string[]
	writeSet?: string[]
	roadmapItemId?: string
	declaresWrites?: boolean
	mutatesRoadmap?: boolean
	mutatesBroccoliDurable?: boolean
	sideEffectTools?: boolean
	requiresExclusiveResource?: boolean
	updatesAuthoritativeReceipt?: boolean
}

export interface LockNecessityResult {
	lockRequired: boolean
	reasonLockAcquired?: string
	reasonLockSkipped?: string
}

const NON_MUTATING_MODES: LaneExecutionMode[] = [
	"read_only",
	"audit_only",
	"planning_only",
	"documentation_only",
	"diagnostic_only",
]

const WRITE_TOOL_NAMES = new Set([
	"write_to_file",
	"edit_file",
	"apply_patch",
	"search_and_replace",
	"insert_content",
	"mem_claim",
])

export function isNonMutatingMode(mode: LaneExecutionMode): boolean {
	return NON_MUTATING_MODES.includes(mode)
}

export function parseExecutionModeFromPrompt(prompt: string): LaneExecutionMode | undefined {
	const header = prompt.match(
		/^\s*\[execution_mode:(read_only|audit_only|planning_only|documentation_only|diagnostic_only|mutation)\]/i,
	)
	return header?.[1]?.toLowerCase() as LaneExecutionMode | undefined
}

export function parseReadSetFromPrompt(prompt: string): string[] {
	const match = prompt.match(/\[read_set:([^\]]+)\]/i)
	if (!match) {
		return []
	}
	return match[1]
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)
}

export function parseWriteSetFromPrompt(prompt: string): string[] {
	const match = prompt.match(/\[write_set:([^\]]+)\]/i)
	if (!match) {
		return []
	}
	return match[1]
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)
}

export function parseDependsOnFromPrompt(prompt: string): number[] {
	const match = prompt.match(/\[depends_on:([^\]]+)\]/i)
	if (!match) {
		return []
	}
	return match[1]
		.split(",")
		.map((part) => Number.parseInt(part.trim(), 10))
		.filter((n) => Number.isFinite(n) && n >= 0)
}

export function parseRoadmapItemFromPrompt(prompt: string): string | undefined {
	const match = prompt.match(/\[roadmap_item:([^\]]+)\]/i)
	return match?.[1]?.trim() || undefined
}

export function resolveLaneLockIntent(
	prompt: string,
	params?: Record<string, string | undefined>,
	index?: number,
): LaneLockIntent {
	const laneKey = index !== undefined ? `execution_mode_${index + 1}` : undefined
	const modeRaw =
		(laneKey && params?.[laneKey]?.trim()) ||
		params?.execution_mode?.trim() ||
		parseExecutionModeFromPrompt(prompt) ||
		"mutation"
	const executionMode = modeRaw.toLowerCase() as LaneExecutionMode
	const readSet = parseReadSetFromPrompt(prompt)
	const writeSet = parseWriteSetFromPrompt(prompt)
	const declaresWrites = writeSet.length > 0 || /\[declares_writes\]/i.test(prompt)

	return {
		executionMode,
		readSet: readSet.length ? readSet : undefined,
		writeSet: writeSet.length ? writeSet : undefined,
		declaresWrites,
		mutatesRoadmap: /\[mutates_roadmap\]/i.test(prompt),
		mutatesBroccoliDurable: /\[mutates_broccoli\]/i.test(prompt),
		sideEffectTools: declaresWrites,
		requiresExclusiveResource: /\[exclusive_resource:[^\]]+\]/i.test(prompt),
		updatesAuthoritativeReceipt: /\[updates_authoritative_receipt\]/i.test(prompt),
	}
}

/** Classify whether governed mutation ownership is required before acquireLane(). */
export function classifyLockNecessity(intent: LaneLockIntent): LockNecessityResult {
	if (intent.executionMode === "mutation") {
		return {
			lockRequired: true,
			reasonLockAcquired: "mutation mode requires governed ownership",
		}
	}

	const mutationSignals = [
		intent.writeSet?.length,
		intent.declaresWrites,
		intent.mutatesRoadmap,
		intent.mutatesBroccoliDurable,
		intent.sideEffectTools,
		intent.requiresExclusiveResource,
		intent.updatesAuthoritativeReceipt,
	].some(Boolean)

	if (mutationSignals) {
		const reasons: string[] = []
		if (intent.writeSet?.length) reasons.push(`write_set: ${intent.writeSet.join(", ")}`)
		if (intent.declaresWrites) reasons.push("declares_writes")
		if (intent.mutatesRoadmap) reasons.push("mutates_roadmap")
		if (intent.mutatesBroccoliDurable) reasons.push("mutates_broccoli")
		if (intent.updatesAuthoritativeReceipt) reasons.push("updates_authoritative_receipt")
		if (intent.requiresExclusiveResource) reasons.push("exclusive_resource")
		return {
			lockRequired: true,
			reasonLockAcquired: `non-mutating mode escalated: ${reasons.join("; ")}`,
		}
	}

	return {
		lockRequired: false,
		reasonLockSkipped: `${intent.executionMode} lane — read/audit/plan/diagnostic only; no mutation declared`,
	}
}

export function envelopeIndicatesWrites(toolSteps?: Array<{ toolName: string }>, touchedFiles?: string[]): boolean {
	if (toolSteps?.some((step) => WRITE_TOOL_NAMES.has(step.toolName))) {
		return true
	}
	return Boolean(touchedFiles?.length && toolSteps?.some((step) => WRITE_TOOL_NAMES.has(step.toolName)))
}

export function splitReadWriteSets(
	executionMode: LaneExecutionMode,
	lockRequired: boolean,
	touchedFiles: string[] | undefined,
	toolSteps: Array<{ toolName: string }> | undefined,
	intentReadSet?: string[],
	intentWriteSet?: string[],
): { readSet: string[]; writeSet: string[] } {
	if (intentReadSet?.length || intentWriteSet?.length) {
		return {
			readSet: intentReadSet ?? [],
			writeSet: intentWriteSet ?? [],
		}
	}
	const touched = touchedFiles ?? []
	if (!lockRequired && isNonMutatingMode(executionMode)) {
		const hasWriteTools = toolSteps?.some((step) => WRITE_TOOL_NAMES.has(step.toolName))
		if (!hasWriteTools) {
			return { readSet: touched, writeSet: [] }
		}
		return { readSet: [], writeSet: touched }
	}
	return { readSet: [], writeSet: touched }
}
