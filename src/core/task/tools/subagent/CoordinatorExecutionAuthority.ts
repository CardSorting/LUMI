import { createHash } from "node:crypto"
import { type BlockerSource, classifyBlockerSeverity, filterAdvisoryParentSignals } from "@shared/subagent/blockerPolicy"
import type {
	CoordinatorContinuationContext,
	CoordinatorHaltDecision,
	CoordinatorHaltRequest,
	GovernanceDiagnosticCode,
	GovernanceDiagnosticEvent,
} from "@shared/subagent/coordinatorAuthority"
import type {
	GovernedContinuationDecision,
	GovernedExecutionPathMetrics,
	GovernedSwarmReceipt,
} from "@shared/subagent/governedExecution"
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

const CONFLICT_FINDING_CODES = new Set([
	"mutation_write_overlap",
	"mutation_without_lock",
	"undeclared_mutation",
	"duplicate_claim",
	"duplicate_claim_id",
	"split_brain",
	"sealed_supersession",
	"roadmap_merge_safety",
	"roadmap_projection_conflict",
])

const INVALID_RESULT_FINDING_CODES = new Set(["lane_status_mismatch", "replay_integrity", "replay_checksum_mismatch"])

/** Single parent continuation authority derived from the final normalized receipt. */
export function reduceGovernedContinuation(options: {
	receipt: GovernedSwarmReceipt
	envelopeStructurallyValid: boolean
	validatedStateUnchanged: boolean
	recoveryActive: boolean
	interrupted?: boolean
	metrics?: GovernedExecutionPathMetrics
}): GovernedContinuationDecision {
	if (options.metrics) {
		options.metrics.continuationReductions++
	}
	const { receipt } = options
	const retryDisposition = receipt.mergeGate.retryDisposition ?? (receipt.mergeGate.passed ? "not_needed" : "targeted_repair")
	const findingCodes = new Set(receipt.mergeGate.findings?.map((finding) => finding.code) ?? [])
	const hasConflict = receipt.mergeGate.splitBrainDetected || [...findingCodes].some((code) => CONFLICT_FINDING_CODES.has(code))
	const hasInvalidResult = [...findingCodes].some((code) => INVALID_RESULT_FINDING_CODES.has(code))
	const convergenceDecision = receipt.confidenceAwareConvergence ?? receipt.mergeGate.confidenceAwareConvergence

	if (convergenceDecision?.decision === "block_hard_failure") {
		return {
			action: "halt_for_conflict",
			retryDisposition: "do_not_retry",
			reasonCode: "confidence_aware_hard_failure",
			cleanPath: false,
			permittedAction: "halt",
		}
	}
	if (convergenceDecision?.decision === "restart_invalid_lane") {
		return {
			action: "targeted_repair",
			retryDisposition: "targeted_repair",
			reasonCode: "structurally_invalid_lane",
			cleanPath: false,
			permittedAction: "repair_lanes",
		}
	}
	if (convergenceDecision?.decision === "targeted_probe") {
		return {
			action: "targeted_probe",
			retryDisposition: "targeted_probe",
			reasonCode: "critical_claim_verification_required",
			cleanPath: false,
			permittedAction: "repair_lanes",
		}
	}

	if (hasConflict || retryDisposition === "do_not_retry") {
		return {
			action: "halt_for_conflict",
			retryDisposition: "do_not_retry",
			reasonCode: hasConflict ? "hard_conflict" : "retry_prohibited",
			cleanPath: false,
			permittedAction: "halt",
		}
	}
	if (options.interrupted) {
		return {
			action: "recover_and_resume",
			retryDisposition: "retry_after_recovery",
			reasonCode: "execution_interrupted",
			cleanPath: false,
			permittedAction: "recover_state",
		}
	}
	if (
		hasInvalidResult ||
		!options.envelopeStructurallyValid ||
		!options.validatedStateUnchanged ||
		!receipt.mergeGate.replayIntegrity.valid
	) {
		return {
			action: "reject_invalid_result",
			retryDisposition: "do_not_retry",
			reasonCode: "execution_state_invalid",
			cleanPath: false,
			permittedAction: "reject",
		}
	}
	if (retryDisposition === "retry_after_recovery") {
		return {
			action: "recover_and_resume",
			retryDisposition,
			reasonCode: "coordination_recovery_required",
			cleanPath: false,
			permittedAction: "recover_state",
		}
	}
	if (retryDisposition === "targeted_repair" || !receipt.sealed || !receipt.mergeGate.passed) {
		return {
			action: "targeted_repair",
			retryDisposition: "targeted_repair",
			reasonCode: "localized_repair_required",
			cleanPath: false,
			permittedAction: "repair_lanes",
		}
	}

	const advisoryCount = receipt.mergeGate.advisoryWarnings?.length ?? 0
	const convergedWithUncertainty = convergenceDecision?.decision === "converge_with_uncertainty"
	return {
		action: advisoryCount > 0 || convergedWithUncertainty ? "accept_with_advisories" : "accept",
		retryDisposition: "not_needed",
		reasonCode: convergedWithUncertainty
			? "sealed_with_bounded_uncertainty"
			: advisoryCount > 0
				? "sealed_with_advisories"
				: "sealed_clean",
		cleanPath:
			!options.recoveryActive &&
			receipt.mergeGate.orphanedClaimCount === 0 &&
			receipt.mergeGate.staleLeaseCount === 0 &&
			receipt.mergeGate.failedLaneCount === 0,
		permittedAction: "continue_parent",
	}
}
