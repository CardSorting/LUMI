import type { GateLifecycleState } from "@shared/completion/completionLifecycle"
import type { TaskConfig } from "../types/TaskConfig"
import { getCachedGateLifecycleDecision } from "./GateLifecycleEvaluator"

const RECOVERY_BLOCKED_STATES: ReadonlySet<GateLifecycleState> = new Set([
	"completion_retry_locked",
	"finalization_ready",
	"engineering_verified",
	"finalization_running",
	"finalization_completed",
	"receipt_sealed",
	"completed_without_retry_completion",
])

export function shouldRejectFakeFollowupQuestion(config: TaskConfig): string | null {
	const decision = getCachedGateLifecycleDecision(config)
	if (!decision || decision.userInputRequired) {
		return null
	}

	if (decision.lifecycleState === "completed_without_retry_completion") {
		return "Follow-up question not allowed — receipt is sealed and session is complete."
	}

	if (decision.lifecycleState === "audit_gate_corrupt") {
		return "Follow-up question not allowed — gate state is corrupt; follow operator recovery guidance."
	}

	if (!decision.moreToolCallsUseful && decision.allowedActions.length === 0) {
		return `Follow-up question not allowed — session is terminal (${decision.lifecycleState}).`
	}

	if (decision.recoveryPath.length > 0 && RECOVERY_BLOCKED_STATES.has(decision.lifecycleState)) {
		const next = decision.recoveryPath[0]
		return `Follow-up question not allowed — use ${next.action}: ${next.description}`
	}

	if (
		decision.engineering === "passed" &&
		decision.finalization !== "passed" &&
		decision.allowedActions.includes("run_finalization")
	) {
		return "Follow-up question not allowed — use run_finalization to finish documentation in this session."
	}

	if (decision.receiptEligible && decision.allowedActions.includes("seal_session")) {
		return "Follow-up question not allowed — seal the receipt with run_finalization seal=true."
	}

	return null
}
