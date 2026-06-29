import { isApiRequestInProgress } from "@shared/agentActivity"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { ResolvedGateLifecycleSnapshot } from "@shared/completion/gateLifecycleMessages"
import type {
	DietCodeMessage,
	DietCodeSaySubagentStatus,
	GovernedReceiptIncident,
	TaskAuditMetadata,
} from "@shared/ExtensionMessage"

export type ExecutionState =
	| "running"
	| "recovering"
	| "approval"
	| "input"
	| "blocked"
	| "failed"
	| "cancelled"
	| "complete"
	| "ready"

export interface ExecutionStatusModel {
	state: ExecutionState
	title: string
	detail: string
	nextAction: string
	safety: string
	confidence: string
}

interface ExecutionStatusOptions {
	messages: readonly DietCodeMessage[]
	auditMetadata?: TaskAuditMetadata
	auditHealth?: AuditHealthSummary
	gateLifecycle?: ResolvedGateLifecycleSnapshot
	checkpointError?: string
}

const APPROVAL_ASKS = new Set<DietCodeMessage["ask"]>([
	"tool",
	"command",
	"command_output",
	"browser_action_launch",
	"use_mcp_server",
	"use_subagents",
])

const INPUT_ASKS = new Set<DietCodeMessage["ask"]>([
	"followup",
	"plan_mode_respond",
	"act_mode_respond",
	"resume_task",
	"new_task",
	"condense",
	"summarize_task",
	"report_bug",
])

function getApprovalDetail(message: DietCodeMessage): string {
	switch (message.ask) {
		case "command":
			return "A terminal command is staged and will not run until you approve it."
		case "command_output":
			return "A command is still running and needs a decision before LUMI continues."
		case "browser_action_launch":
			return "External browser activity is staged for your review."
		case "use_mcp_server":
			return "An external tool request is waiting for permission."
		case "use_subagents":
			return "Delegated agent work is staged and waiting for permission."
		case "tool":
			try {
				const tool = JSON.parse(message.text || "{}") as { tool?: string }
				if (["editedExistingFile", "newFileCreated", "fileDeleted"].includes(tool.tool ?? "")) {
					return "Proposed workspace changes are ready for review."
				}
			} catch {
				// Use the durable generic label when older messages are not structured JSON.
			}
			return "A tool action is staged and will not run until you approve it."
		default:
			return "An agent action is waiting for your review."
	}
}

function getSafetyLabel(
	auditMetadata: TaskAuditMetadata | undefined,
	auditHealth: AuditHealthSummary | undefined,
	gateLifecycle: ResolvedGateLifecycleSnapshot | undefined,
): string {
	if (auditMetadata?.gate_blocked) return "Gate blocked"
	if ((auditHealth?.criticalViolationCount ?? 0) > 0) return "Critical issue"
	if ((auditHealth?.warningViolationCount ?? 0) > 0) return "Review advised"
	if (gateLifecycle?.freshness === "stale" || gateLifecycle?.freshness === "unknown") {
		return gateLifecycle.decision ? "Snapshot stale" : "Active"
	}
	if (gateLifecycle?.decision?.verification === "passed") return "Passed"
	return "Active"
}

function getCompletionConfidence(
	state: ExecutionState,
	auditHealth: AuditHealthSummary | undefined,
	gateLifecycle: ResolvedGateLifecycleSnapshot | undefined,
): string {
	if (state === "blocked" || state === "failed") return "Not ready"
	if (state === "cancelled") return "Stopped"
	if (state !== "complete") return "Pending"
	if (gateLifecycle?.freshness === "current" && gateLifecycle.decision?.completionReceipt) return "Receipt sealed"
	if (auditHealth?.latestGrade) return `${auditHealth.latestGrade} audit`
	if (
		auditHealth &&
		auditHealth.criticalViolationCount === 0 &&
		auditHealth.warningViolationCount === 0 &&
		auditHealth.snapshotCount > 0
	) {
		return "Checks passed"
	}
	return "Reported complete"
}

function wasCancelled(message: DietCodeMessage | undefined): boolean {
	if (message?.type !== "say" || message.say !== "api_req_started") return false
	try {
		return (JSON.parse(message.text || "{}") as { cancelReason?: string }).cancelReason === "user_cancelled"
	} catch {
		return false
	}
}

function getReceiptIncident(message: DietCodeMessage | undefined): {
	incident?: GovernedReceiptIncident
	retrySafe?: boolean
} {
	if (message?.say !== "subagent" || !message.text) return {}
	try {
		const status = JSON.parse(message.text) as DietCodeSaySubagentStatus
		return {
			incident: status.governedReceipt?.diagnostics?.incident,
			retrySafe: status.governedReceipt?.diagnostics?.retrySafe,
		}
	} catch {
		return {}
	}
}

export function deriveExecutionStatus({
	messages,
	auditMetadata,
	auditHealth,
	gateLifecycle,
	checkpointError,
}: ExecutionStatusOptions): ExecutionStatusModel {
	const lastMessage = messages.at(-1)
	const safety = getSafetyLabel(auditMetadata, auditHealth, gateLifecycle)
	const receipt = getReceiptIncident(lastMessage)
	const lifecycleState = gateLifecycle?.decision?.lifecycleState
	const completionMessage =
		lastMessage?.ask === "completion_result" ||
		lastMessage?.ask === "resume_completed_task" ||
		lastMessage?.say === "completion_result"

	let status: Omit<ExecutionStatusModel, "safety" | "confidence">

	if (checkpointError) {
		status = {
			state: "failed",
			title: "Recovery required",
			detail: "The workspace checkpoint could not be created or restored safely.",
			nextAction: "Open task details and review the checkpoint error.",
		}
	} else if (auditMetadata?.gate_blocked) {
		status = {
			state: "blocked",
			title: "Completion held for review",
			detail: "The safety gate found unresolved evidence and stopped completion.",
			nextAction: "Review the blocked finding before retrying completion.",
		}
	} else if (receipt.incident === "partial_receipt") {
		status = {
			state: "blocked",
			title: "Completion evidence is partial",
			detail: "Some governed execution evidence is missing, so the receipt is not sealed.",
			nextAction: receipt.retrySafe
				? "Review the missing evidence, then use the safe recovery path."
				: "Review the receipt. Do not retry until LUMI marks recovery safe.",
		}
	} else if (
		receipt.incident &&
		[
			"failed_receipt",
			"stale_claim",
			"unsafe_retry",
			"corrupted_receipt",
			"replay_mismatch",
			"backend_unavailable",
			"merge_blocked",
		].includes(receipt.incident)
	) {
		status = {
			state: receipt.incident === "backend_unavailable" ? "failed" : "blocked",
			title: receipt.incident === "unsafe_retry" ? "Unsafe retry blocked" : "Receipt needs attention",
			detail: "The governed receipt could not be sealed with complete, authoritative evidence.",
			nextAction: receipt.retrySafe
				? "Follow the recovery path in the receipt."
				: "Inspect the receipt before retrying or merging changes.",
		}
	} else if (lifecycleState === "audit_gate_corrupt") {
		status = {
			state: "blocked",
			title: "Safety gate unavailable",
			detail: gateLifecycle?.decision?.operatorMessage ?? "The completion gate stopped in a fail-closed state.",
			nextAction: gateLifecycle?.decision?.recoveryPath.at(0)?.description ?? "Repair the gate state before continuing.",
		}
	} else if (wasCancelled(lastMessage)) {
		status = {
			state: "cancelled",
			title: "Execution stopped",
			detail: "The active model turn was cancelled. Completed workspace changes remain in place.",
			nextAction: "Review the timeline, then resume with updated guidance when ready.",
		}
	} else if (
		lastMessage?.say === "api_req_retried" ||
		lastMessage?.say === "error_retry" ||
		receipt.incident === "in_progress" ||
		lifecycleState === "completion_retry_locked" ||
		lifecycleState === "finalization_running" ||
		lifecycleState === "finalization_completed" ||
		lifecycleState === "receipt_sealed"
	) {
		status = {
			state: "recovering",
			title:
				lifecycleState === "completion_retry_locked"
					? "Finalization is retry-locked"
					: lifecycleState?.startsWith("finalization") || lifecycleState === "receipt_sealed"
						? "Finalizing execution"
						: "Recovering execution",
			detail:
				lifecycleState === "completion_retry_locked"
					? "Engineering is verified. Duplicate completion attempts are blocked while finalization runs."
					: "LUMI is restoring a safe execution path and preserving completed work.",
			nextAction: "No action required. Wait for the current recovery step to settle.",
		}
	} else if (completionMessage && gateLifecycle?.decision && gateLifecycle.freshness !== "current") {
		status = {
			state: "blocked",
			title: "Completion status is stale",
			detail: "The latest safety snapshot is not current enough to trust as final evidence.",
			nextAction: "Wait for a fresh gate evaluation before treating the task as complete.",
		}
	} else if (
		lastMessage?.type === "ask" &&
		(lastMessage.ask === "api_req_failed" || lastMessage.ask === "mistake_limit_reached")
	) {
		status = {
			state: "failed",
			title: "Execution interrupted",
			detail:
				lastMessage.ask === "api_req_failed"
					? "The model request failed before the task could continue."
					: "LUMI stopped after repeated unsuccessful attempts.",
			nextAction: "Choose a recovery action below.",
		}
	} else if (lastMessage?.type === "say" && (lastMessage.say === "error" || lastMessage.say === "command_permission_denied")) {
		status = {
			state: "failed",
			title: "Execution interrupted",
			detail: "The latest action did not complete successfully.",
			nextAction: "Review the error in the timeline and choose a recovery path.",
		}
	} else if (lifecycleState === "completed_without_retry_completion" || receipt.incident === "sealed_success") {
		status = {
			state: "complete",
			title: "Execution complete",
			detail: "The governed receipt is sealed and the session has authoritative completion evidence.",
			nextAction: "Review the receipt or start a new task.",
		}
	} else if (
		lastMessage?.type === "ask" &&
		(lastMessage.ask === "completion_result" || lastMessage.ask === "resume_completed_task")
	) {
		status = {
			state: "complete",
			title: "Execution complete",
			detail: "The final outcome and available evidence are recorded in the timeline.",
			nextAction: "Review the receipt or start a new task.",
		}
	} else if (lastMessage?.type === "say" && lastMessage.say === "completion_result") {
		status = {
			state: "complete",
			title: "Finalizing outcome",
			detail: "Work is complete and the final receipt is being presented.",
			nextAction: "Review the outcome and verification evidence.",
		}
	} else if (lastMessage?.type === "ask" && APPROVAL_ASKS.has(lastMessage.ask)) {
		status = {
			state: "approval",
			title: "Approval required",
			detail: getApprovalDetail(lastMessage),
			nextAction: "Review the risk, then approve or decline below.",
		}
	} else if (lastMessage?.type === "ask" && INPUT_ASKS.has(lastMessage.ask)) {
		status = {
			state: "input",
			title: lastMessage.ask === "resume_task" ? "Ready to resume" : "Input required",
			detail: "LUMI is paused at a decision point and will not continue without you.",
			nextAction: "Respond below to continue or choose another path.",
		}
	} else if (
		lastMessage?.partial === true ||
		(lastMessage !== undefined && isApiRequestInProgress(lastMessage)) ||
		(lastMessage?.type === "say" && lastMessage.say === "command" && lastMessage.commandCompleted !== true)
	) {
		status = {
			state: "running",
			title: "Execution in progress",
			detail: "LUMI is working through the current step. You can steer or stop it at any time.",
			nextAction: "No action required. Monitor the timeline or add guidance.",
		}
	} else if (gateLifecycle?.decision?.userInputRequired) {
		status = {
			state: "input",
			title: "Gate decision required",
			detail: gateLifecycle.decision.operatorMessage,
			nextAction: gateLifecycle.decision.recoveryPath.at(0)?.description ?? "Review the gate evidence before continuing.",
		}
	} else {
		status = {
			state: "ready",
			title: "Ready for direction",
			detail: "The current execution step is settled and LUMI can accept follow-up guidance.",
			nextAction: "Add a follow-up or inspect the execution timeline.",
		}
	}

	return {
		...status,
		safety,
		confidence: getCompletionConfidence(status.state, auditHealth, gateLifecycle),
	}
}
