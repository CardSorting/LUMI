/**
 * Three-tier blocker policy (ADR-015 throughput pass).
 * Only hard blockers may halt execution; soft triggers repair; advisory is forensic only.
 */

export type BlockerSeverity = "hard" | "soft" | "advisory"

export type BlockerSource =
	| "coordinator_merge"
	| "coordinator_corruption"
	| "coordinator_lock"
	| "receipt_pointer"
	| "audit_preflight"
	| "completion_gate"
	| "lane_gate"
	| "parent_context"
	| "subagent_local"

const HARD_MERGE_PATTERNS = [
	/split-brain/i,
	/unreleased claims/i,
	/replay checksum mismatch/i,
	/corrupted/i,
	/missing transcript/i,
	/failed lanes/i,
	/orphaned claims/i,
]

const SOFT_PATTERNS = [
	/supersede prior sealed/i,
	/stale lease/i,
	/partial receipt/i,
	/missing context/i,
	/ambiguous/i,
	/retry cooldown/i,
	/duplicate submission/i,
]

export function classifyBlockerSeverity(source: BlockerSource, reason: string): BlockerSeverity {
	if (source === "parent_context" || source === "audit_preflight") {
		return "advisory"
	}
	if (source === "receipt_pointer" && !HARD_MERGE_PATTERNS.some((p) => p.test(reason))) {
		return "advisory"
	}
	if (source === "completion_gate" && SOFT_PATTERNS.some((p) => p.test(reason))) {
		return "soft"
	}
	if (source === "coordinator_merge" || source === "coordinator_corruption" || source === "coordinator_lock") {
		if (SOFT_PATTERNS.some((p) => p.test(reason)) && !HARD_MERGE_PATTERNS.some((p) => p.test(reason))) {
			return "soft"
		}
		return "hard"
	}
	if (HARD_MERGE_PATTERNS.some((p) => p.test(reason))) {
		return "hard"
	}
	if (SOFT_PATTERNS.some((p) => p.test(reason))) {
		return "soft"
	}
	if (source === "lane_gate") {
		return reason.includes("preflight") || reason.includes("advisory") ? "advisory" : "hard"
	}
	return "hard"
}

/** Parent gate signals injected into subagents are always advisory — never lane-blocking authority. */
export function isAdvisoryParentGateSignal(signal: string): boolean {
	return signal.startsWith("ADVISORY:")
}

export function isHardParentGateSignal(signal: string): boolean {
	return signal.startsWith("SIGNAL: PARENT_CRITICAL")
}

export function filterAdvisoryParentSignals(signals: string[]): string[] {
	return signals.filter(isAdvisoryParentGateSignal)
}

/** Lane authority state for compact progress handoff — parent reads coordinator truth, not receipt drama. */
export type LaneAuthorityState = "executing" | "partial" | "waiting_coordinator" | "blocked_hard" | "done"

export function deriveLaneAuthorityState(options: {
	status: "running" | "completed" | "failed" | "pending"
	hardError?: string
	advisorySignalCount: number
	hasPartialResult?: boolean
}): LaneAuthorityState {
	if (options.status === "completed") {
		return "done"
	}
	if (options.status === "failed" && options.hardError) {
		return "blocked_hard"
	}
	if (options.hasPartialResult && options.status === "running") {
		return "partial"
	}
	if (options.advisorySignalCount > 0 && options.status === "running") {
		return "executing"
	}
	if (options.status === "pending") {
		return "waiting_coordinator"
	}
	return "executing"
}

/** Bounded retry budget for soft blockers — prevents infinite soft-block loops. */
export class SoftBlockRetryBudget {
	private readonly counts = new Map<string, number>()

	constructor(private readonly maxSoftRetries = 3) {}

	consume(key: string): { allowed: boolean; exhausted: boolean; attempt: number } {
		const attempt = (this.counts.get(key) ?? 0) + 1
		this.counts.set(key, attempt)
		return {
			allowed: attempt <= this.maxSoftRetries,
			exhausted: attempt > this.maxSoftRetries,
			attempt,
		}
	}

	reset(key: string): void {
		this.counts.delete(key)
	}

	snapshot(key: string): number {
		return this.counts.get(key) ?? 0
	}
}

const softBudgetByTask = new Map<string, SoftBlockRetryBudget>()

export function getSoftBlockRetryBudget(taskId: string): SoftBlockRetryBudget {
	let budget = softBudgetByTask.get(taskId)
	if (!budget) {
		budget = new SoftBlockRetryBudget()
		softBudgetByTask.set(taskId, budget)
	}
	return budget
}

export function resetSoftBlockRetryBudget(taskId: string): void {
	softBudgetByTask.delete(taskId)
}
