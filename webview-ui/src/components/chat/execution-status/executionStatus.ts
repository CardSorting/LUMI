import { isApiRequestInProgress } from "@shared/agentActivity"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { ResolvedCompletionFunnelSnapshot } from "@shared/completion/completionFunnelMessages"
import { hasTerminalCompletionEvidence } from "@shared/completion/taskCompletionEvidence"
import { sanitizeWebviewMessageContent } from "@shared/diagnostics/webviewDiagnostics"
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
	completionFunnel?: ResolvedCompletionFunnelSnapshot
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
	completionFunnel: ResolvedCompletionFunnelSnapshot | undefined,
): string {
	if (auditMetadata?.gate_blocked) return "Advisory findings"
	if ((auditHealth?.criticalViolationCount ?? 0) > 0) return "Critical issue"
	if ((auditHealth?.warningViolationCount ?? 0) > 0) return "Review advised"
	if (completionFunnel?.terminalCompletion || completionFunnel?.event?.phase === "ready") return "Passed"
	return "Active"
}

function getCompletionConfidence(
	state: ExecutionState,
	auditHealth: AuditHealthSummary | undefined,
	_completionFunnel: ResolvedCompletionFunnelSnapshot | undefined,
	terminalCompletion: boolean,
): string {
	if (state === "blocked" || state === "failed") return "Not ready"
	if (state === "cancelled") return "Stopped"
	if (state !== "complete") return "Pending"
	if (terminalCompletion) return "Recorded"
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
	completionFunnel,
	checkpointError,
}: ExecutionStatusOptions): ExecutionStatusModel {
	const lastMessage = messages.at(-1)
	const safety = getSafetyLabel(auditMetadata, auditHealth, completionFunnel)
	const receipt = getReceiptIncident(lastMessage)
	const terminalCompletion = completionFunnel?.terminalCompletion ?? hasTerminalCompletionEvidence(messages)
	const funnelEvent = completionFunnel?.event

	let status: Omit<ExecutionStatusModel, "safety" | "confidence">

	if (terminalCompletion || funnelEvent?.terminal) {
		status = {
			state: "complete",
			title: "Execution complete",
			detail: "The final outcome is recorded and older pending gate projections are no longer actionable.",
			nextAction: "Review the result or start a new task.",
		}
	} else if (checkpointError) {
		status = {
			state: "failed",
			title: "Recovery required",
			detail: "The workspace checkpoint could not be created or restored safely.",
			nextAction: "Open task details and review the checkpoint error.",
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
	} else if (wasCancelled(lastMessage)) {
		status = {
			state: "cancelled",
			title: "Execution stopped",
			detail: "The active model turn was cancelled. Completed workspace changes remain in place.",
			nextAction: "Review the timeline, then resume with updated guidance when ready.",
		}
	} else if (receipt.incident === "sealed_success") {
		status = {
			state: "complete",
			title: "Execution complete",
			detail: "The final outcome is recorded and older pending gate projections are no longer actionable.",
			nextAction: "Review the result or start a new task.",
		}
	} else if (funnelEvent?.phase === "failed" || funnelEvent?.phase === "blocked") {
		status = {
			state: funnelEvent.phase === "failed" ? "failed" : "blocked",
			title: funnelEvent.phase === "failed" ? "Completion blocked" : "Workspace changes required",
			detail: funnelEvent.reason,
			nextAction:
				funnelEvent.nextAllowedAction === "none"
					? "Review the funnel audit trace."
					: `Continue with ${funnelEvent.nextAllowedAction}.`,
		}
	} else if (
		lastMessage?.say === "api_req_retried" ||
		lastMessage?.say === "error_retry" ||
		receipt.incident === "in_progress"
	) {
		status = {
			state: "recovering",
			title: "Recovering execution",
			detail: "LUMI is restoring a safe execution path and preserving completed work.",
			nextAction: "No action required. Wait for the current recovery step to settle.",
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
	} else {
		status = {
			state: "ready",
			title: "Ready for direction",
			detail: "The current execution step is settled and LUMI can accept follow-up guidance.",
			nextAction: "Add a follow-up or inspect the execution timeline.",
		}
	}

	return {
		state: status.state,
		title: sanitizeWebviewMessageContent(status.title),
		detail: sanitizeWebviewMessageContent(status.detail),
		nextAction: sanitizeWebviewMessageContent(status.nextAction),
		safety: sanitizeWebviewMessageContent(safety),
		confidence: sanitizeWebviewMessageContent(
			getCompletionConfidence(status.state, auditHealth, completionFunnel, terminalCompletion),
		),
	}
}
