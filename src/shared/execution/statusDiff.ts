import type { DietCodeSaySubagentStatus } from "@shared/ExtensionMessage"

export type ExecutionDiffChangeKind = "added" | "removed" | "changed" | "unchanged"

export interface ExecutionAgentDiff {
	agentId: string
	index?: number
	label: string
	statusBefore?: string
	statusAfter?: string
	changeKind: ExecutionDiffChangeKind
	toolStepDelta: number
	evidenceDelta: number
	transcriptEventDelta: number
	touchedFilesAdded: string[]
	touchedFilesRemoved: string[]
	blockersAdded: string[]
	warningsAdded: string[]
}

export interface ExecutionDiffReport {
	identical: boolean
	leftArtifactId: string
	rightArtifactId: string
	agentDiffs: ExecutionAgentDiff[]
	invariantViolationsAdded: string[]
	invariantViolationsRemoved: string[]
	transcriptDeltaTotal: number
	summary: string
}

function diffStringSets(before: string[], after: string[]): { added: string[]; removed: string[] } {
	const beforeSet = new Set(before)
	const afterSet = new Set(after)
	return {
		added: after.filter((value) => !beforeSet.has(value)),
		removed: before.filter((value) => !afterSet.has(value)),
	}
}

export function diffSubagentStatuses(left: DietCodeSaySubagentStatus, right: DietCodeSaySubagentStatus): ExecutionDiffReport {
	const leftAgents = new Map(left.items.map((item) => [item.id, item]))
	const rightAgents = new Map(right.items.map((item) => [item.id, item]))
	const allAgentIds = new Set([...leftAgents.keys(), ...rightAgents.keys()])

	const agentDiffs: ExecutionAgentDiff[] = []
	let transcriptDeltaTotal = 0

	for (const agentId of allAgentIds) {
		const before = leftAgents.get(agentId)
		const after = rightAgents.get(agentId)

		if (!before && after) {
			agentDiffs.push({
				agentId,
				index: after.index,
				label: after.name,
				statusAfter: after.status,
				changeKind: "added",
				toolStepDelta: after.toolCalls,
				evidenceDelta: after.evidenceCount || 0,
				transcriptEventDelta: after.transcriptEventCount || 0,
				touchedFilesAdded: after.touchedFiles || [],
				touchedFilesRemoved: [],
				blockersAdded: after.blockers || [],
				warningsAdded: after.warnings || [],
			})
			transcriptDeltaTotal += after.transcriptEventCount || 0
			continue
		}

		if (before && !after) {
			agentDiffs.push({
				agentId,
				index: before.index,
				label: before.name,
				statusBefore: before.status,
				changeKind: "removed",
				toolStepDelta: -before.toolCalls,
				evidenceDelta: -(before.evidenceCount || 0),
				transcriptEventDelta: -(before.transcriptEventCount || 0),
				touchedFilesAdded: [],
				touchedFilesRemoved: before.touchedFiles || [],
				blockersAdded: [],
				warningsAdded: [],
			})
			transcriptDeltaTotal -= before.transcriptEventCount || 0
			continue
		}

		if (!before || !after) {
			continue
		}

		const touchedDiff = diffStringSets(before.touchedFiles || [], after.touchedFiles || [])
		const blockersDiff = diffStringSets(before.blockers || [], after.blockers || [])
		const warningsDiff = diffStringSets(before.warnings || [], after.warnings || [])
		const toolStepDelta = after.toolCalls - before.toolCalls
		const evidenceDelta = (after.evidenceCount || 0) - (before.evidenceCount || 0)
		const transcriptEventDelta = (after.transcriptEventCount || 0) - (before.transcriptEventCount || 0)
		transcriptDeltaTotal += transcriptEventDelta

		const changed =
			before.status !== after.status ||
			toolStepDelta !== 0 ||
			evidenceDelta !== 0 ||
			transcriptEventDelta !== 0 ||
			touchedDiff.added.length > 0 ||
			touchedDiff.removed.length > 0 ||
			blockersDiff.added.length > 0 ||
			warningsDiff.added.length > 0

		agentDiffs.push({
			agentId,
			index: after.index,
			label: after.name,
			statusBefore: before.status,
			statusAfter: after.status,
			changeKind: changed ? "changed" : "unchanged",
			toolStepDelta,
			evidenceDelta,
			transcriptEventDelta,
			touchedFilesAdded: touchedDiff.added,
			touchedFilesRemoved: touchedDiff.removed,
			blockersAdded: blockersDiff.added,
			warningsAdded: warningsDiff.added,
		})
	}

	const leftViolations = new Set(left.invariantViolations || [])
	const rightViolations = new Set(right.invariantViolations || [])
	const invariantViolationsAdded = [...rightViolations].filter((value) => !leftViolations.has(value))
	const invariantViolationsRemoved = [...leftViolations].filter((value) => !rightViolations.has(value))

	const identical =
		agentDiffs.every((diff) => diff.changeKind === "unchanged") &&
		invariantViolationsAdded.length === 0 &&
		invariantViolationsRemoved.length === 0

	const changedCount = agentDiffs.filter((diff) => diff.changeKind === "changed").length
	const summary = identical
		? "Executions are identical on tracked surfaces."
		: `${changedCount} agent(s) changed; transcript delta ${transcriptDeltaTotal}.`

	return {
		identical,
		leftArtifactId: left.swarmId || "left",
		rightArtifactId: right.swarmId || "right",
		agentDiffs,
		invariantViolationsAdded,
		invariantViolationsRemoved,
		transcriptDeltaTotal,
		summary,
	}
}
