import type { DietCodeMessage, DietCodeSayTool } from "@shared/ExtensionMessage"
import type { ButtonActionType, ButtonConfig } from "./buttonConfig"

export type ActionRisk = "low" | "medium" | "high"
export type ActionPanelKind = "approval" | "recovery" | "completion" | "control" | "other"

export interface ActionPresentation {
	kind: ActionPanelKind
	summary: string
	resource?: string
	risk: ActionRisk
	riskLabel: string
	riskDetail: string
	reversibility: string
	isDestructive: boolean
	recommendedAction?: ButtonActionType
	approveLabel?: string
}

interface PresentationOptions {
	checkpointAvailable?: boolean
	lifecycleCompleted?: boolean
}

const APPROVAL_ASKS = new Set<DietCodeMessage["ask"]>([
	"tool",
	"command",
	"command_output",
	"browser_action_launch",
	"use_mcp_server",
	"use_subagents",
])

const HIGH_RISK_COMMAND = /(^|\s)(rm\s+(-[^\s]*f[^\s]*\s+)?|git\s+reset\s+--hard|drop\s+(table|database)|del\s+\/)/i

function compact(value: string | undefined, max = 92): string | undefined {
	const singleLine = value?.replace(/\s+/g, " ").trim()
	if (!singleLine) return undefined
	return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine
}

function parseJson<T>(value: string | undefined): T | undefined {
	try {
		return JSON.parse(value || "{}") as T
	} catch {
		return undefined
	}
}

function checkpointCopy(checkpointAvailable: boolean, fallback: string): string {
	return checkpointAvailable ? "Undo available from the task checkpoint." : fallback
}

export function getActionPresentation(
	message: DietCodeMessage | undefined,
	config: ButtonConfig,
	options: PresentationOptions = {},
): ActionPresentation {
	const checkpointAvailable = options.checkpointAvailable === true
	const recommendedAction = config.primaryAction

	if (!message) {
		return {
			kind: "other",
			summary: "Choose how LUMI should continue",
			risk: "low",
			riskLabel: "Low risk",
			riskDetail: "No external action is pending.",
			reversibility: "No workspace change is staged.",
			isDestructive: false,
			recommendedAction,
		}
	}

	if (message.type === "ask" && message.ask === "api_req_failed") {
		return {
			kind: "recovery",
			summary: "The model request did not finish",
			risk: "low",
			riskLabel: "Safe to retry",
			riskDetail: "Retrying starts a fresh model request.",
			reversibility: "Existing workspace changes are preserved.",
			isDestructive: false,
			recommendedAction,
		}
	}

	if (message.type === "ask" && message.ask === "mistake_limit_reached") {
		return {
			kind: "recovery",
			summary: "LUMI paused after repeated attempts",
			risk: "medium",
			riskLabel: "Review first",
			riskDetail: "Continuing may repeat the unsuccessful approach.",
			reversibility: checkpointCopy(checkpointAvailable, "Use version control to recover prior workspace state."),
			isDestructive: false,
			recommendedAction: config.secondaryAction ?? config.primaryAction,
		}
	}

	if (message.type === "ask" && (message.ask === "completion_result" || message.ask === "resume_completed_task")) {
		if (options.lifecycleCompleted !== true) {
			return {
				kind: "other",
				summary: "Completion outcome awaiting lifecycle record",
				risk: "low",
				riskLabel: "Pending",
				riskDetail: "The task generation is not yet projected as terminal completed.",
				reversibility: "Wait for the committed lifecycle event before continuing.",
				isDestructive: false,
				recommendedAction,
			}
		}
		return {
			kind: "completion",
			summary: "Task complete",
			risk: "low",
			riskLabel: "No action required",
			riskDetail: "The execution has ended.",
			reversibility: "Review the receipt before starting another task.",
			isDestructive: false,
			recommendedAction,
		}
	}

	if (config.secondaryAction === "cancel" && !config.primaryAction) {
		return {
			kind: "control",
			summary: "Execution is active",
			risk: "low",
			riskLabel: "Stop available",
			riskDetail: "Stopping interrupts the current model turn.",
			reversibility: "Completed workspace changes remain in place.",
			isDestructive: false,
			recommendedAction: undefined,
		}
	}

	if (message.type === "ask" && message.ask === "tool") {
		const tool = parseJson<DietCodeSayTool>(message.text)
		const resource = compact(tool?.path)
		const outsideWorkspace = message.isOperationOutsideWorkspace || tool?.operationIsLocatedInWorkspace === false

		switch (tool?.tool) {
			case "fileDeleted":
				return {
					kind: "approval",
					summary: "Delete a workspace file",
					resource,
					risk: "high",
					riskLabel: "Destructive",
					riskDetail: "This removes a file from the workspace.",
					reversibility: checkpointCopy(checkpointAvailable, "Recovery may require version control or a backup."),
					isDestructive: true,
					recommendedAction: config.secondaryAction,
					approveLabel: "Delete file",
				}
			case "editedExistingFile":
			case "newFileCreated":
				return {
					kind: "approval",
					summary: "Apply workspace changes",
					resource,
					risk: outsideWorkspace ? "high" : "medium",
					riskLabel: outsideWorkspace ? "Outside workspace" : "Workspace write",
					riskDetail: outsideWorkspace
						? "The requested write is outside the active workspace."
						: "This writes to your current workspace.",
					reversibility: checkpointCopy(checkpointAvailable, "Review the diff; recovery depends on version control."),
					isDestructive: outsideWorkspace,
					recommendedAction: outsideWorkspace ? config.secondaryAction : config.primaryAction,
				}
			default:
				return {
					kind: "approval",
					summary: "Allow read-only access",
					resource,
					risk: outsideWorkspace ? "medium" : "low",
					riskLabel: outsideWorkspace ? "External path" : "Read only",
					riskDetail: outsideWorkspace
						? "This reads from outside the active workspace."
						: "No workspace content will be changed.",
					reversibility: "No workspace change is staged.",
					isDestructive: false,
					recommendedAction: config.primaryAction,
				}
		}
	}

	if (message.type === "ask" && (message.ask === "command" || message.ask === "command_output")) {
		const resource = compact(message.text?.split("\n")[0])
		const destructive = message.ask === "command" && HIGH_RISK_COMMAND.test(message.text || "")
		return {
			kind: "approval",
			summary: message.ask === "command_output" ? "Keep the command running" : "Run a terminal command",
			resource,
			risk: destructive ? "high" : "medium",
			riskLabel: destructive ? "Destructive command" : "Terminal access",
			riskDetail: destructive
				? "The command may remove data or discard workspace changes."
				: "The command can modify files or external systems.",
			reversibility: checkpointCopy(checkpointAvailable, "Command effects may not be automatically reversible."),
			isDestructive: destructive,
			recommendedAction: destructive ? config.secondaryAction : config.primaryAction,
			approveLabel: destructive ? "Run destructive command" : config.primaryText,
		}
	}

	if (message.type === "ask" && message.ask === "browser_action_launch") {
		const data = parseJson<{ url?: string }>(message.text)
		return {
			kind: "approval",
			summary: "Open an external browser session",
			resource: compact(data?.url ?? message.text),
			risk: "medium",
			riskLabel: "External activity",
			riskDetail: "The browser can interact with content outside the workspace.",
			reversibility: "The browser session can be stopped; submitted data cannot be recalled.",
			isDestructive: false,
			recommendedAction,
		}
	}

	if (message.type === "ask" && message.ask === "use_mcp_server") {
		const data = parseJson<{ serverName?: string; toolName?: string; tool?: string }>(message.text)
		return {
			kind: "approval",
			summary: "Use a connected external tool",
			resource: compact([data?.serverName, data?.toolName ?? data?.tool].filter(Boolean).join(" · ")),
			risk: "medium",
			riskLabel: "External tool",
			riskDetail: "Selected context may be sent to the connected service.",
			reversibility: "Data already sent to an external service cannot be recalled.",
			isDestructive: false,
			recommendedAction,
		}
	}

	if (message.type === "ask" && message.ask === "use_subagents") {
		return {
			kind: "approval",
			summary: "Delegate work to additional agents",
			risk: "medium",
			riskLabel: "Delegated execution",
			riskDetail: "Additional agents may use tools within the approved scope.",
			reversibility: "Delegated execution can be stopped; completed changes remain.",
			isDestructive: false,
			recommendedAction,
		}
	}

	return {
		kind: message.type === "ask" && APPROVAL_ASKS.has(message.ask) ? "approval" : "other",
		summary: "Choose how LUMI should continue",
		risk: "medium",
		riskLabel: "Review required",
		riskDetail: "Inspect the request before continuing.",
		reversibility: "Recovery depends on the requested action.",
		isDestructive: false,
		recommendedAction,
	}
}

interface ShortcutContext {
	key: string
	metaKey?: boolean
	ctrlKey?: boolean
	isPanelFocused: boolean
	isExecutionControl: boolean
	isApproval: boolean
	isDestructive: boolean
	primaryAction?: ButtonActionType
	secondaryAction?: ButtonActionType
}

/** Resolves only deliberate, context-safe action shortcuts. */
export function resolveActionShortcut(context: ShortcutContext): ButtonActionType | undefined {
	if (context.key === "Escape") {
		if (context.isExecutionControl) return "cancel"
		if (context.isPanelFocused && context.secondaryAction === "reject") return "reject"
		return undefined
	}

	if (context.key === "Enter" && (context.metaKey || context.ctrlKey) && context.isApproval && !context.isDestructive) {
		return context.primaryAction
	}

	return undefined
}
