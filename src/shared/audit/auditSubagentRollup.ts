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
	if (signal.startsWith(PARENT_GATE_SIGNAL_PREFIX)) {
		const match = signal.match(/GATE: PARENT_BLOCKED \((\d+)\)/)
		return match ? `Parent gate blocked (${match[1]}×)` : "Parent gate blocked"
	}
	return SUBAGENT_PARENT_SIGNAL_LABELS[signal] ?? signal.replace(/^SIGNAL: /, "")
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
