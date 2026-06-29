import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import type { GateLifecycleState } from "@shared/completion/completionLifecycle"
import type { FinalizationEvidence } from "@shared/completion/finalizationEvidence"
import type { GateAction, GateRecoveryStep } from "@shared/completion/gateActions"
import { buildGateLifecycleDecision, type GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import type { GateReasonCode } from "@shared/completion/gateReasonCodes"
import { appendLifecycleTransitionLog } from "@shared/completion/lifecycleTransitionLog"
import {
	getCompletionGateCircuitBreakerError,
	getCompletionGraphRevision,
	getLatestCheckpointHashFromMessages,
	isCompletionGateCircuitBreakerTripped,
} from "../attemptCompletionUtils"
import type { TaskConfig } from "../types/TaskConfig"
import { validateGateLifecycleDecision } from "./gateLifecycleInvariants"

function parseFinalizationEvidence(config: TaskConfig): FinalizationEvidence | undefined {
	const raw = config.taskState.finalizationEvidenceJson
	if (!raw) return undefined
	try {
		return JSON.parse(raw) as FinalizationEvidence
	} catch {
		return undefined
	}
}

export function isTaskHarnessTerminal(taskState: {
	completionLifecycleState?: string
	lastGateLifecycleDecision?: string
}): boolean {
	const state = taskState.completionLifecycleState as GateLifecycleState | undefined
	if (state === "completed_without_retry_completion" || state === "audit_gate_corrupt") {
		return true
	}
	if (taskState.lastGateLifecycleDecision) {
		try {
			const decision = JSON.parse(taskState.lastGateLifecycleDecision) as { moreToolCallsUseful?: boolean }
			if (decision.moreToolCallsUseful === false) {
				return true
			}
		} catch {
			// ignore parse errors
		}
	}
	return false
}

export function isCompletionHarnessTerminal(config: TaskConfig): boolean {
	return isTaskHarnessTerminal(config.taskState)
}

export function getCachedGateLifecycleDecision(config: TaskConfig): GateLifecycleDecision | undefined {
	const raw = config.taskState.lastGateLifecycleDecision
	if (!raw) return undefined
	try {
		return JSON.parse(raw) as GateLifecycleDecision
	} catch {
		return undefined
	}
}

export function cacheGateLifecycleDecision(config: TaskConfig, decision: GateLifecycleDecision): void {
	validateGateLifecycleDecision(decision)
	config.taskState.lastGateLifecycleDecision = JSON.stringify(decision)
	config.taskState.completionLifecycleState = decision.lifecycleState
	config.taskState.lastGateLifecycleDecisionGraphRevision = getCompletionGraphRevision(config)
	config.taskState.lastGateLifecycleDecisionCheckpointHash = getLatestCheckpointHashFromMessages(config)
	config.taskState.lifecycleTransitionLogJson = appendLifecycleTransitionLog(config.taskState.lifecycleTransitionLogJson, {
		state: decision.lifecycleState,
		reasonCode: decision.reasonCode,
		at: decision.evaluatedAt,
	})
}

export async function publishGateLifecycleStatus(config: TaskConfig, decision: GateLifecycleDecision): Promise<void> {
	cacheGateLifecycleDecision(config, decision)
	try {
		await config.callbacks.say("info", decision.operatorMessage, undefined, undefined, false, undefined, decision)
	} catch {
		// Operator surface is best-effort; task state remains authoritative.
	}
}

export function latchEngineeringVerified(config: TaskConfig, checkpointHash?: string): void {
	if (config.taskState.engineeringVerifiedAt) {
		return
	}
	config.taskState.engineeringVerifiedAt = Date.now()
	if (checkpointHash) {
		config.taskState.engineeringVerifiedCheckpointHash = checkpointHash
	}
}

export function isEngineeringVerified(config: TaskConfig): boolean {
	return typeof config.taskState.engineeringVerifiedAt === "number"
}

export function isCompletionRetryLocked(config: TaskConfig): boolean {
	return isCompletionGateCircuitBreakerTripped(config)
}

function buildFinalizationRecovery(): GateRecoveryStep[] {
	return [
		{
			order: 1,
			action: "run_finalization",
			description: "Run same-session finalization to update documentation and stamp the ledger.",
		},
		{
			order: 2,
			action: "emit_receipt",
			description: "Emit the sealed receipt after finalization validates.",
		},
		{
			order: 3,
			action: "seal_session",
			description: "Seal the session in this task — no further attempt_completion required.",
		},
	]
}

export function buildRetryLockedDecision(config: TaskConfig): GateLifecycleDecision {
	const evidence = parseFinalizationEvidence(config)
	const engineeringVerified = isEngineeringVerified(config)

	const allowedActions: GateAction[] = engineeringVerified
		? ["run_finalization", "emit_receipt", "seal_session", "act_mode_respond"]
		: ["act_mode_respond", "run_verification"]

	const lifecycleState: GateLifecycleState = engineeringVerified
		? evidence?.status === "passed"
			? "receipt_sealed"
			: "finalization_ready"
		: "completion_retry_locked"

	return buildGateLifecycleDecision({
		lifecycleState,
		activeLane: engineeringVerified ? "finalization" : "completion",
		reasonCode: "retry.locked",
		operatorMessage: engineeringVerified
			? "Engineering verified. Completion retry is locked — finalization lane active in this session."
			: `Completion retry locked (${config.taskState.completionGateBlockCount ?? MAX_COMPLETION_GATE_BLOCK_COUNT}/${MAX_COMPLETION_GATE_BLOCK_COUNT}). Fix engineering violations, then use the finalization lane.`,
		engineering: engineeringVerified ? "passed" : "failed",
		verification: engineeringVerified ? "passed" : "pending",
		documentation: evidence?.docsUpdated.length ? "passed" : "pending",
		ledger: evidence?.ledgerStamped ? "passed" : "pending",
		finalization: evidence?.status === "passed" ? "passed" : engineeringVerified ? "pending" : "not_applicable",
		allowedActions,
		forbiddenActions: ["attempt_completion"],
		recoveryPath: engineeringVerified ? buildFinalizationRecovery() : [],
		receiptEligible: evidence?.status === "passed",
		moreToolCallsUseful: engineeringVerified,
		userInputRequired: false,
		httpStatus: 403,
		finalizationEvidence: evidence,
	})
}

export function evaluateGateLifecycle(config: TaskConfig): GateLifecycleDecision {
	const cached = getCachedGateLifecycleDecision(config)
	if (
		cached &&
		(cached.lifecycleState === "completed_without_retry_completion" || cached.lifecycleState === "audit_gate_corrupt")
	) {
		return cached
	}

	const currentRevision = getCompletionGraphRevision(config)
	const currentCheckpointHash = getLatestCheckpointHashFromMessages(config)
	if (
		cached &&
		config.taskState.lastGateLifecycleDecisionGraphRevision === currentRevision &&
		config.taskState.lastGateLifecycleDecisionCheckpointHash === currentCheckpointHash
	) {
		return cached
	}

	if (isCompletionRetryLocked(config) || getCompletionGateCircuitBreakerError(config)) {
		const decision = buildRetryLockedDecision(config)
		cacheGateLifecycleDecision(config, decision)
		return decision
	}

	const engineeringVerified = isEngineeringVerified(config)
	if (engineeringVerified) {
		const evidence = parseFinalizationEvidence(config)
		const lifecycleState: GateLifecycleState =
			config.taskState.finalizationPhase === "completed"
				? "finalization_completed"
				: config.taskState.finalizationPhase === "running"
					? "finalization_running"
					: evidence?.status === "passed"
						? "receipt_sealed"
						: "engineering_verified"

		const reasonCode: GateReasonCode =
			lifecycleState === "receipt_sealed"
				? "receipt.sealed"
				: lifecycleState === "engineering_verified"
					? "engineering.verified"
					: lifecycleState === "finalization_completed"
						? "finalization.completed"
						: lifecycleState === "finalization_running"
							? "finalization.running"
							: "finalization.ready"

		const decision = buildGateLifecycleDecision({
			lifecycleState,
			activeLane: "finalization",
			reasonCode,
			operatorMessage:
				lifecycleState === "receipt_sealed"
					? "Finalization complete. Seal the receipt to end this session."
					: lifecycleState === "engineering_verified"
						? "Engineering verified. Run finalization when documentation and ledger are ready."
						: lifecycleState === "finalization_running"
							? "Finalization running — updating documentation and ledger in this session."
							: lifecycleState === "finalization_completed"
								? "Finalization completed. Seal the receipt to end this session."
								: "Engineering verified. Run finalization to update documentation in this session.",
			engineering: "passed",
			verification: "passed",
			documentation: evidence?.docsUpdated.length ? "passed" : "pending",
			ledger: evidence?.ledgerStamped ? "passed" : "pending",
			finalization: evidence?.status === "passed" ? "passed" : "pending",
			allowedActions: ["run_finalization", "emit_receipt", "seal_session"],
			forbiddenActions: [],
			recoveryPath: buildFinalizationRecovery(),
			receiptEligible: evidence?.status === "passed",
			moreToolCallsUseful: true,
			userInputRequired: false,
			finalizationEvidence: evidence,
		})
		cacheGateLifecycleDecision(config, decision)
		return decision
	}

	const decision = buildGateLifecycleDecision({
		lifecycleState: "engineering_in_progress",
		activeLane: "completion",
		reasonCode: "preflight.unknown",
		operatorMessage:
			"Complete engineering work, then call attempt_completion. Use run_finalization after engineering is verified.",
		engineering: "pending",
		verification: "pending",
		documentation: "pending",
		ledger: "pending",
		finalization: "not_applicable",
		allowedActions: ["attempt_completion", "run_verification"],
		forbiddenActions: [],
		recoveryPath: [],
		receiptEligible: false,
		moreToolCallsUseful: true,
		userInputRequired: false,
	})

	cacheGateLifecycleDecision(config, decision)
	return decision
}

export function canRunFinalization(config: TaskConfig): boolean {
	return evaluateGateLifecycle(config).allowedActions.includes("run_finalization")
}

export function mapPreflightReasonToLifecycleState(config: TaskConfig, reason: string): GateLifecycleDecision {
	if (isCompletionRetryLocked(config) && isEngineeringVerified(config)) {
		return buildRetryLockedDecision(config)
	}

	const base = evaluateGateLifecycle(config)
	const reasonCode: GateReasonCode =
		reason === "circuit_breaker"
			? "preflight.circuit_breaker"
			: reason === "audit_gate"
				? "audit.blocked"
				: reason === "audit_error"
					? "audit.error"
					: "preflight.quality"

	return buildGateLifecycleDecision({
		...base,
		lifecycleState: isEngineeringVerified(config) ? "finalization_ready" : "engineering_in_progress",
		reasonCode,
		operatorMessage: isEngineeringVerified(config)
			? "Engineering verified. Address remaining gate items via run_finalization in this session."
			: base.operatorMessage,
		moreToolCallsUseful: true,
		userInputRequired: false,
	})
}
