import { createHash } from "node:crypto"
import {
	type BlockerSource,
	classifyBlockerSeverity,
	filterAdvisoryParentSignals,
	getSoftBlockRetryBudget,
} from "@shared/subagent/blockerPolicy"
import type {
	CoordinatorContinuationContext,
	CoordinatorHaltDecision,
	CoordinatorHaltRequest,
	GovernanceDiagnosticCode,
	GovernanceDiagnosticEvent,
} from "@shared/subagent/coordinatorAuthority"
import type { GovernedSwarmReceipt } from "@shared/subagent/governedExecution"
import type { GatePreflightReadinessIssue } from "@/core/task/tools/completionGatePipeline"

const PARALYSIS_REPEAT_THRESHOLD = 3

export type GovernanceParalysisSnapshot = {
	diagnostics: GovernanceDiagnosticEvent[]
	lastValidationKey?: string
	repeatCount: number
}

/** Tracks validation retries without workspace progress — detects governance paralysis. */
export class GovernanceParalysisTracker {
	private readonly entries: Array<{ at: number; key: string; workspaceFingerprint?: string }> = []

	record(validationKey: string, workspaceFingerprint?: string): GovernanceDiagnosticEvent[] {
		const now = Date.now()
		const prior = this.entries.filter((e) => e.key === validationKey)
		const last = prior[prior.length - 1]
		const workspaceUnchanged =
			last && workspaceFingerprint !== undefined && last.workspaceFingerprint === workspaceFingerprint

		this.entries.push({ at: now, key: validationKey, workspaceFingerprint })
		if (this.entries.length > 32) {
			this.entries.splice(0, this.entries.length - 32)
		}

		const events: GovernanceDiagnosticEvent[] = []
		const repeatCount = prior.length + 1

		if (repeatCount >= PARALYSIS_REPEAT_THRESHOLD && workspaceUnchanged) {
			events.push({
				code: "no_progress_execution_loop",
				message: `Repeated validation "${validationKey}" ${repeatCount}× without workspace change.`,
				at: now,
			})
		}
		if (repeatCount >= 2 && workspaceUnchanged) {
			events.push({
				code: "governance_recursion_detected",
				message: `Governance path "${validationKey}" re-entered without state progress.`,
				at: now,
			})
		}
		return events
	}

	snapshot(validationKey?: string): GovernanceParalysisSnapshot {
		const matching = validationKey ? this.entries.filter((e) => e.key === validationKey) : this.entries
		return {
			diagnostics: [],
			lastValidationKey: validationKey,
			repeatCount: matching.length,
		}
	}
}

function diagnostic(code: GovernanceDiagnosticCode, message: string): GovernanceDiagnosticEvent {
	return { code, message, at: Date.now() }
}

/**
 * Reconcile a proposed halt against coordinator-owned live state.
 * Receipt/audit artifacts alone must not halt when authoritative state allows continuation.
 */
export function evaluateCoordinatorHaltDecision(request: CoordinatorHaltRequest): CoordinatorHaltDecision {
	const { proposedReason, source, context } = request
	const diagnostics: GovernanceDiagnosticEvent[] = []
	const severity = classifyBlockerSeverity(source as BlockerSource, proposedReason)

	if (severity === "advisory") {
		diagnostics.push(
			diagnostic(
				"duplicate_audit_path_detected",
				`Advisory ${source} signal must not halt: ${proposedReason.slice(0, 120)}`,
			),
		)
		return {
			shouldHalt: false,
			diagnostics,
			receiptDerivedOnly: source === "receipt_pointer" || source === "audit_preflight",
		}
	}

	const authoritative = context.authoritativeAttemptId
	const latest = context.latestPointerAttemptId
	const lineageLinked = Boolean(context.parentAttemptId) && Boolean(authoritative) && context.parentAttemptId === authoritative

	if (
		source === "receipt_pointer" &&
		authoritative &&
		latest &&
		latest !== authoritative &&
		proposedReason.includes("supersede")
	) {
		diagnostics.push(
			diagnostic(
				"stale_receipt_authority_detected",
				`Latest receipt pointer (${latest}) differs from authoritative sealed attempt (${authoritative}).`,
			),
		)
		if (lineageLinked || severity === "soft") {
			return {
				shouldHalt: false,
				diagnostics,
				receiptDerivedOnly: true,
			}
		}
	}

	if (source === "audit_preflight" || source === "completion_gate") {
		if (proposedReason.includes("preflight") || proposedReason.includes("advisory") || severity === "soft") {
			diagnostics.push(
				diagnostic(
					"duplicate_audit_path_detected",
					"Advisory preflight must not halt swarm execution without coordinator cold-path confirmation.",
				),
			)
			return {
				shouldHalt: false,
				diagnostics,
				receiptDerivedOnly: true,
			}
		}
	}

	if (source === "merge_gate" && proposedReason.includes("supersede") && (lineageLinked || severity === "soft")) {
		return {
			shouldHalt: false,
			diagnostics,
			receiptDerivedOnly: severity === "soft",
		}
	}

	if (severity === "soft" && !context.hasRunningLanes) {
		return {
			shouldHalt: false,
			diagnostics,
			receiptDerivedOnly: false,
		}
	}

	return {
		shouldHalt: true,
		reason: proposedReason,
		diagnostics,
		receiptDerivedOnly: false,
	}
}

/** Parent gate signals are forensic context — lanes continue unless coordinator confirms a hard block. */
export function resolveContinuationFromParentSignals(signals: string[]): {
	shouldContinue: boolean
	advisorySignals: string[]
	diagnostics: GovernanceDiagnosticEvent[]
} {
	const advisorySignals = filterAdvisoryParentSignals(signals)
	if (advisorySignals.length === 0) {
		return { shouldContinue: true, advisorySignals: [], diagnostics: [] }
	}
	return {
		shouldContinue: true,
		advisorySignals,
		diagnostics: [
			diagnostic(
				"duplicate_audit_path_detected",
				`${advisorySignals.length} parent gate signal(s) recorded as advisory — lane execution continues.`,
			),
		],
	}
}

/** Collapse duplicate governance diagnostics emitted from overlapping gate paths. */
export function mergeGovernanceDiagnostics(
	existing: GovernanceDiagnosticEvent[] | undefined,
	incoming: GovernanceDiagnosticEvent[],
): GovernanceDiagnosticEvent[] {
	const merged = [...(existing ?? []), ...incoming]
	const seen = new Set<string>()
	const deduped: GovernanceDiagnosticEvent[] = []
	for (const event of merged) {
		const key = `${event.code}:${event.message.slice(0, 80)}`
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		deduped.push(event)
	}
	return deduped.slice(-16)
}

/** Resolve prior sealed receipt for merge gate — authoritative history, not stale latest pointer. */
export function resolvePriorSealedReceiptForMerge(
	authoritative: GovernedSwarmReceipt | null,
	latestPointer: GovernedSwarmReceipt | null,
): { prior: GovernedSwarmReceipt | null; diagnostics: GovernanceDiagnosticEvent[] } {
	const diagnostics: GovernanceDiagnosticEvent[] = []
	if (authoritative?.sealed && authoritative.mergeGate.passed) {
		if (latestPointer && latestPointer.attemptId !== authoritative.attemptId) {
			diagnostics.push(
				diagnostic(
					"stale_receipt_authority_detected",
					`Using authoritative attempt ${authoritative.attemptId} instead of latest pointer ${latestPointer.attemptId}.`,
				),
			)
		}
		return { prior: authoritative, diagnostics }
	}
	if (latestPointer?.sealed && latestPointer.mergeGate.passed) {
		return { prior: latestPointer, diagnostics }
	}
	return { prior: null, diagnostics }
}

export function buildCoordinatorContinuationContext(
	taskId: string,
	options: {
		swarmId?: string
		attemptId?: string
		parentAttemptId?: string
		authoritativeReceipt?: GovernedSwarmReceipt | null
		latestPointerReceipt?: GovernedSwarmReceipt | null
		hasRunningLanes?: boolean
	},
): CoordinatorContinuationContext {
	return {
		taskId,
		swarmId: options.swarmId,
		attemptId: options.attemptId,
		parentAttemptId: options.parentAttemptId,
		authoritativeAttemptId:
			options.authoritativeReceipt?.sealed && options.authoritativeReceipt.mergeGate.passed
				? options.authoritativeReceipt.attemptId
				: undefined,
		latestPointerAttemptId: options.latestPointerReceipt?.attemptId,
		hasRunningLanes: options.hasRunningLanes,
	}
}

/** Preflight issues at swarm seal are forensic only — never fail seal. */
export function classifyPreflightIssuesForSeal(issues: GatePreflightReadinessIssue[]): {
	advisory: GatePreflightReadinessIssue[]
	diagnostics: GovernanceDiagnosticEvent[]
} {
	const diagnostics: GovernanceDiagnosticEvent[] = []
	const advisory = issues.map((issue) => {
		if (issue.severity !== "info") {
			diagnostics.push(
				diagnostic(
					"duplicate_audit_path_detected",
					`Seal preflight stage "${issue.stage}" recorded as advisory: ${issue.message.slice(0, 120)}`,
				),
			)
		}
		return { ...issue, severity: "info" as const }
	})
	return { advisory, diagnostics }
}

export function hashWorkspaceFingerprint(input: string): string {
	return createHash("sha256").update(input.trim()).digest("hex").slice(0, 16)
}

const paralysisByTask = new Map<string, GovernanceParalysisTracker>()

export function getGovernanceParalysisTracker(taskId: string): GovernanceParalysisTracker {
	let tracker = paralysisByTask.get(taskId)
	if (!tracker) {
		tracker = new GovernanceParalysisTracker()
		paralysisByTask.set(taskId, tracker)
	}
	return tracker
}

export function resetGovernanceParalysisTracker(taskId: string): void {
	paralysisByTask.delete(taskId)
}

export interface CoordinatorFastContinuationDecision {
	shouldContinue: boolean
	reason: string
	diagnostics: GovernanceDiagnosticEvent[]
}

/**
 * Fast-path continuation when no live coordinator hard blocker exists.
 * Receipt/audit/historical artifacts alone never justify halting.
 */
export function evaluateCoordinatorFastContinuation(options: {
	taskId: string
	hasRunningLanes?: boolean
	proposedHardBlockers?: string[]
	proposedSoftBlockers?: string[]
	advisorySignalCount?: number
}): CoordinatorFastContinuationDecision {
	const diagnostics: GovernanceDiagnosticEvent[] = []
	const hard = options.proposedHardBlockers ?? []
	const soft = options.proposedSoftBlockers ?? []

	if (hard.length > 0) {
		const confirmed = hard.filter((reason) => classifyBlockerSeverity("coordinator_merge", reason) === "hard")
		if (confirmed.length > 0) {
			return {
				shouldContinue: false,
				reason: confirmed[0],
				diagnostics,
			}
		}
	}

	if (soft.length > 0) {
		const budget = getSoftBlockRetryBudget(options.taskId)
		const key = soft[0] ?? "soft_block"
		const retry = budget.consume(key)
		if (!retry.allowed) {
			diagnostics.push(
				diagnostic("no_progress_execution_loop", `Soft blocker "${key}" exceeded retry budget (${retry.attempt}).`),
			)
			return {
				shouldContinue: options.hasRunningLanes === true,
				reason: `soft_block_exhausted:${key}`,
				diagnostics,
			}
		}
		diagnostics.push(
			diagnostic("duplicate_audit_path_detected", `Soft blocker deferred (attempt ${retry.attempt}): ${key.slice(0, 80)}`),
		)
	}

	if ((options.advisorySignalCount ?? 0) > 0) {
		diagnostics.push(
			diagnostic(
				"duplicate_audit_path_detected",
				`${options.advisorySignalCount} advisory signal(s) recorded — continuation allowed.`,
			),
		)
	}

	return {
		shouldContinue: true,
		reason: "no_live_hard_blocker",
		diagnostics,
	}
}
