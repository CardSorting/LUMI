import type { DietCodeMessage, DietCodeSaySubagentStatus, SubagentStatusItem } from "@shared/ExtensionMessage"

export type SubagentSwarmStatus = DietCodeSaySubagentStatus["status"]

export interface SubagentAuditSummary {
	/** Latest swarm lifecycle status from chat history. */
	swarmStatus: SubagentSwarmStatus | null
	totalAgents: number
	runningCount: number
	completedCount: number
	failedCount: number
	pendingCount: number
	/** Unique parent gate / audit signals propagated to subagents. */
	parentGateSignals: string[]
	hasParentGateBlocked: boolean
	hasParentAdvisoryFindings: boolean
	hasParentCriticalViolations: boolean
	hasWorkspacePolicySignal: boolean
}

const PARENT_GATE_SIGNAL_PREFIX = "GATE: PARENT_BLOCKED"
const PARENT_SIGNAL_PATTERNS = {
	gateBlocked: "SIGNAL: PARENT_GATE_BLOCKED",
	completionGateBlocked: "SIGNAL: PARENT_COMPLETION_GATE_BLOCKED",
	gateMarginal: "SIGNAL: PARENT_GATE_MARGINAL",
	advisoryFindings: "SIGNAL: PARENT_ADVISORY_FINDINGS",
	criticalViolations: "SIGNAL: PARENT_CRITICAL_VIOLATIONS",
	workspacePolicy: "SIGNAL: PARENT_WORKSPACE_GATE_POLICY",
	suppressedViolations: "SIGNAL: PARENT_SUPPRESSED_VIOLATIONS",
} as const

/** Strip advisory wrapper so rollup accepts both legacy GATE: and ADVISORY: GATE: signals. */
function normalizeParentGateSignal(signal: string): string {
	return signal.replace(/^ADVISORY: (?:SIGNAL: )?/, "")
}

export const SUBAGENT_PARENT_SIGNAL_LABELS: Record<string, string> = {
	[PARENT_SIGNAL_PATTERNS.gateBlocked]: "Parent gate blocked",
	[PARENT_SIGNAL_PATTERNS.completionGateBlocked]: "Parent completion gate blocked",
	[PARENT_SIGNAL_PATTERNS.gateMarginal]: "Parent gate marginal",
	[PARENT_SIGNAL_PATTERNS.advisoryFindings]: "Parent advisory findings",
	[PARENT_SIGNAL_PATTERNS.criticalViolations]: "Parent critical violations",
	[PARENT_SIGNAL_PATTERNS.workspacePolicy]: "Workspace gate policy active",
	[PARENT_SIGNAL_PATTERNS.suppressedViolations]: "Parent suppressed violations",
}

export function formatSubagentParentSignal(signal: string): string {
	const normalized = normalizeParentGateSignal(signal)
	if (normalized.startsWith(PARENT_GATE_SIGNAL_PREFIX)) {
		const match = normalized.match(/GATE: PARENT_BLOCKED \((\d+)\)/)
		return match ? `Parent gate blocked (${match[1]}×)` : "Parent gate blocked"
	}
	if (normalized.startsWith("GATE: PARENT_LAST_REASON")) {
		const match = normalized.match(/GATE: PARENT_LAST_REASON \((.+)\)/)
		return match ? `Parent last gate reason: ${match[1]}` : "Parent last gate reason"
	}
	if (normalized.startsWith("GATE: PARENT_FAILED_STAGE")) {
		const match = normalized.match(/GATE: PARENT_FAILED_STAGE \((.+)\)/)
		return match ? `Parent failed gate stage: ${match[1]}` : "Parent failed gate stage"
	}
	if (normalized.startsWith("GATE: PARENT_PRESSURE")) {
		const match = normalized.match(/GATE: PARENT_PRESSURE \((.+)\)/)
		return match ? `Parent gate pressure: ${match[1]}` : "Parent gate pressure"
	}
	if (normalized.startsWith("GATE: PARENT_ATTEMPTS")) {
		const match = normalized.match(/GATE: PARENT_ATTEMPTS \((\d+)\)/)
		return match ? `Parent completion attempts: ${match[1]}` : "Parent completion attempts"
	}
	if (normalized.startsWith("GATE: PARENT_RETRY_STATUS")) {
		const match = normalized.match(/GATE: PARENT_RETRY_STATUS \((.+)\)/)
		return match ? `Parent gate retry status: ${match[1]}` : "Parent gate retry status"
	}
	if (normalized.startsWith("GATE: PARENT_BLOCK_HISTORY")) {
		const match = normalized.match(/GATE: PARENT_BLOCK_HISTORY \((\d+)\)/)
		return match ? `Parent gate block history: ${match[1]} events` : "Parent gate block history"
	}
	if (normalized.startsWith("GATE: PARENT_SESSION")) {
		const match = normalized.match(/GATE: PARENT_SESSION \((.+)\)/)
		return match ? `Parent gate session: ${match[1]}` : "Parent gate session"
	}
	return SUBAGENT_PARENT_SIGNAL_LABELS[normalized] ?? normalized.replace(/^SIGNAL: /, "")
}

export function isParentGateSignal(signal: string): boolean {
	const normalized = normalizeParentGateSignal(signal)
	return normalized.startsWith("GATE:") || normalized.startsWith("SIGNAL: PARENT_") || normalized.includes("PARENT_")
}

function parseSubagentStatusPayload(message: DietCodeMessage): DietCodeSaySubagentStatus | undefined {
	if (message.say !== "subagent" || !message.text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(message.text) as DietCodeSaySubagentStatus
		if (!Array.isArray(parsed.items)) {
			return undefined
		}
		return parsed
	} catch {
		return undefined
	}
}

/** Returns the most recent subagent swarm status payload from chat history. */
export function getLatestSubagentStatusFromMessages(messages: DietCodeMessage[]): DietCodeSaySubagentStatus | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const payload = parseSubagentStatusPayload(messages[i])
		if (payload) {
			return payload
		}
	}
	return undefined
}

function collectParentGateSignals(items: SubagentStatusItem[]): string[] {
	const signals = new Set<string>()
	for (const item of items) {
		for (const signal of item.criticalSignals ?? []) {
			if (signal.startsWith("GATE:") || signal.startsWith("SIGNAL: PARENT_") || signal.includes("PARENT_")) {
				signals.add(signal)
			}
		}
	}
	return Array.from(signals)
}

/** Aggregates subagent swarm audit handoff state for parent task header UI. */
export function buildSubagentAuditSummary(messages: DietCodeMessage[]): SubagentAuditSummary | undefined {
	const latest = getLatestSubagentStatusFromMessages(messages)
	if (!latest || latest.items.length === 0) {
		return undefined
	}

	const runningCount = latest.items.filter((item) => item.status === "running").length
	const completedCount = latest.items.filter((item) => item.status === "completed").length
	const failedCount = latest.items.filter((item) => item.status === "failed").length
	const pendingCount = latest.items.filter((item) => item.status === "pending").length
	const parentGateSignals = collectParentGateSignals(latest.items)

	return {
		swarmStatus: latest.status,
		totalAgents: latest.items.length,
		runningCount,
		completedCount,
		failedCount,
		pendingCount,
		parentGateSignals,
		hasParentGateBlocked: parentGateSignals.some(
			(signal) =>
				signal.startsWith(PARENT_GATE_SIGNAL_PREFIX) ||
				signal === PARENT_SIGNAL_PATTERNS.gateBlocked ||
				signal === PARENT_SIGNAL_PATTERNS.completionGateBlocked,
		),
		hasParentAdvisoryFindings: parentGateSignals.includes(PARENT_SIGNAL_PATTERNS.advisoryFindings),
		hasParentCriticalViolations: parentGateSignals.includes(PARENT_SIGNAL_PATTERNS.criticalViolations),
		hasWorkspacePolicySignal: parentGateSignals.includes(PARENT_SIGNAL_PATTERNS.workspacePolicy),
	}
}

export function shouldShowSubagentAuditSummary(summary: SubagentAuditSummary | undefined): boolean {
	if (!summary) {
		return false
	}
	if (summary.swarmStatus === "running" || summary.runningCount > 0 || summary.pendingCount > 0) {
		return true
	}
	return summary.parentGateSignals.length > 0
}

/** Markdown section for subagent parent-audit handoff — mirrors CI downstream job context. */
export function buildSubagentHandoffMarkdown(summary: SubagentAuditSummary): string {
	const lines = ["## Subagent Audit Handoff", ""]
	lines.push(`- Swarm status: ${summary.swarmStatus ?? "unknown"}`)
	lines.push(
		`- Agents: ${summary.totalAgents} (${summary.runningCount} running, ${summary.completedCount} done, ${summary.failedCount} failed)`,
	)
	if (summary.parentGateSignals.length > 0) {
		lines.push("- Parent gate signals propagated to subagents:")
		for (const signal of summary.parentGateSignals) {
			lines.push(`  - ${formatSubagentParentSignal(signal)}`)
		}
	}
	lines.push("")
	return lines.join("\n")
}
