import type { DietCodeMessage, DietCodeSaySubagentStatus } from "@shared/ExtensionMessage"
import { diffSubagentStatuses } from "@shared/execution/statusDiff"

export function parseSubagentStatusMessage(message: DietCodeMessage): DietCodeSaySubagentStatus | null {
	if (message.say !== "subagent" || !message.text) {
		return null
	}
	try {
		const parsed = JSON.parse(message.text) as DietCodeSaySubagentStatus
		if (!Array.isArray(parsed.items)) {
			return null
		}
		return parsed
	} catch {
		return null
	}
}

export function collectSubagentStatuses(messages: DietCodeMessage[]): DietCodeSaySubagentStatus[] {
	const statuses: DietCodeSaySubagentStatus[] = []
	for (const message of messages) {
		const parsed = parseSubagentStatusMessage(message)
		if (parsed?.swarmId) {
			statuses.push(parsed)
		}
	}
	return statuses
}

export function buildLatestExecutionDiff(messages: DietCodeMessage[]) {
	const statuses = collectSubagentStatuses(messages)
	if (statuses.length < 2) {
		return undefined
	}
	const right = statuses[statuses.length - 1]
	const left = statuses[statuses.length - 2]
	return {
		diff: diffSubagentStatuses(left, right),
		leftLabel: left.swarmId?.slice(0, 8) || "previous",
		rightLabel: right.swarmId?.slice(0, 8) || "latest",
	}
}
