/**
 * Permission handling for ACP integration.
 *
 * This module handles the translation between ACP permission requests/responses
 * and Codemarie's internal permission system. It maps CodemarieAsk types to appropriate
 * ACP permission options and translates user responses back to Codemarie's format.
 *
 * @module acp/permissionHandler
 */

import type * as acp from "@agentclientprotocol/sdk"
import type { CodemarieAsk } from "@shared/ExtensionMessage"
import type { CodemarieAskResponse } from "@shared/WebviewMessage"
import { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger.js"
import type { AcpSessionState, CodemariePermissionOption } from "./types.js"

/**
 * Standard permission options for operations that support "always allow".
 * Used for commands, tools, and MCP server operations.
 */
const STANDARD_PERMISSION_OPTIONS: CodemariePermissionOption[] = [
	{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
	{ kind: "allow_always", optionId: "allow_always", name: "Always Allow" },
	{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
]

/**
 * Permission options for operations that don't support "always allow".
 * Used for browser actions and other one-time operations.
 */
const RESTRICTED_PERMISSION_OPTIONS: CodemariePermissionOption[] = [
	{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
	{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
]

/**
 * Mapping of CodemarieAsk types to their permission option sets.
 */
const ASK_TYPE_PERMISSION_MAP: Partial<Record<CodemarieAsk, CodemariePermissionOption[]>> = {
	// Commands support "always allow" for auto-approval
	command: STANDARD_PERMISSION_OPTIONS,

	// Tool operations support "always allow"
	tool: STANDARD_PERMISSION_OPTIONS,

	// MCP server operations support "always allow"
	use_mcp_server: STANDARD_PERMISSION_OPTIONS,

	// Browser actions are one-time, no "always allow"
	browser_action_launch: RESTRICTED_PERMISSION_OPTIONS,

	// Command output continuation - simple allow/reject
	command_output: RESTRICTED_PERMISSION_OPTIONS,
}

/**
 * CodemarieAsk types that require permission handling.
 * Other ask types (like followup, plan_mode_respond) don't need permission UI.
 */
const PERMISSION_REQUIRING_ASK_TYPES: Set<CodemarieAsk> = new Set([
	"command",
	"tool",
	"browser_action_launch",
	"use_mcp_server",
	"command_output",
])

/**
 * Result of handling a permission response.
 */
export interface PermissionHandlerResult {
	/** Codemarie's internal response type */
	response: CodemarieAskResponse
	/** Optional text to pass with the response */
	text?: string
	/** Whether "always allow" was selected (for auto-approval tracking) */
	alwaysAllow?: boolean
	/** Whether the request was cancelled */
	cancelled?: boolean
}

/**
 * Check if a CodemarieAsk type requires permission handling.
 *
 * @param askType - The CodemarieAsk type to check
 * @returns True if the ask type requires permission UI
 */
export function requiresPermission(askType: CodemarieAsk): boolean {
	return PERMISSION_REQUIRING_ASK_TYPES.has(askType)
}

/**
 * Get the appropriate permission options for a CodemarieAsk type.
 *
 * @param askType - The CodemarieAsk type
 * @returns Array of permission options, or undefined if the ask type doesn't require permission
 */
export function getPermissionOptionsForAskType(askType: CodemarieAsk): acp.PermissionOption[] | undefined {
	const options = ASK_TYPE_PERMISSION_MAP[askType]
	if (!options) {
		return undefined
	}

	// Convert to ACP PermissionOption format
	return options.map((opt) => ({
		kind: opt.kind,
		optionId: opt.optionId,
		name: opt.name,
	}))
}

/**
 * Handle an ACP permission response and translate it to Codemarie's format.
 *
 * @param response - The ACP permission response from the client
 * @param _askType - The original CodemarieAsk type that triggered the permission request
 * @returns The translated result for Codemarie's handleWebviewAskResponse
 */
export function handlePermissionResponse(
	response: acp.RequestPermissionResponse,
	_askType: CodemarieAsk,
): PermissionHandlerResult {
	// Check if cancelled
	if (response.outcome.outcome === "cancelled") {
		return {
			response: "noButtonClicked",
			cancelled: true,
		}
	}

	// Get the selected option ID
	const optionId = response.outcome.optionId

	// Translate the option to Codemarie's response format
	switch (optionId) {
		case "allow_once":
			return {
				response: "yesButtonClicked",
				alwaysAllow: false,
			}

		case "allow_always":
			return {
				response: "yesButtonClicked",
				alwaysAllow: true,
			}

		case "reject_once":
		case "reject_always":
			return {
				response: "noButtonClicked",
				alwaysAllow: false,
			}

		default:
			// Unknown option ID - treat as rejection for safety
			Logger.error(`[permissionHandler] Unknown permission option: ${optionId}`)
			return {
				response: "noButtonClicked",
			}
	}
}

/**
 * Create a permission request for an ACP tool call.
 *
 * @param toolCall - The ACP tool call that needs permission
 * @param askType - The Codemarie ask type
 * @returns The permission request options, or null if no permission needed
 */
export function createPermissionRequest(
	toolCall: acp.ToolCall,
	askType: CodemarieAsk,
): { toolCall: acp.ToolCall; options: acp.PermissionOption[] } | null {
	const options = getPermissionOptionsForAskType(askType)
	if (!options) {
		return null
	}

	return {
		toolCall,
		options,
	}
}

/**
 * Track "always allow" decisions for auto-approval.
 * This maintains a set of tool/command patterns that have been auto-approved.
 * Uses persistent StateManager for storage.
 */
export class AutoApprovalTracker {
	/**
	 * Record an "always allow" decision for a permission request.
	 *
	 * @param askType - The Codemarie ask type that was auto-approved
	 * @param identifier - The identifier for the operation (command, tool name, etc.)
	 */
	recordAlwaysAllow(askType: CodemarieAsk, identifier: string): void {
		const stateManager = StateManager.get()
		switch (askType) {
			case "command":
				// Store the first word of the command as the key
				const commandPrefix = identifier.split(" ")[0]
				stateManager.addTrustedCommand(commandPrefix)
				break

			case "tool":
				stateManager.addTrustedTool(identifier)
				break

			case "use_mcp_server":
				stateManager.addTrustedMcpServer(identifier)
				break
		}
	}

	/**
	 * Check if an operation has been auto-approved.
	 *
	 * @param askType - The Codemarie ask type
	 * @param identifier - The identifier for the operation
	 * @returns True if the operation was previously auto-approved or persistently trusted
	 */
	isAutoApproved(askType: CodemarieAsk, identifier: string): boolean {
		const stateManager = StateManager.get()
		switch (askType) {
			case "command": {
				const commandPrefix = identifier.split(" ")[0]
				const trustedCommands = stateManager.getTrustedCommands()
				return trustedCommands.some((trusted) => {
					if (trusted.endsWith("*")) {
						return identifier.startsWith(trusted.slice(0, -1))
					}
					return commandPrefix === trusted || identifier === trusted
				})
			}

			case "tool":
				return stateManager.getTrustedTools().includes(identifier)

			case "use_mcp_server":
				return stateManager.getTrustedMcpServers().includes(identifier)

			default:
				return false
		}
	}

	/**
	 * Clear all auto-approval records.
	 */
	clear(): void {
		StateManager.get().clearPersistentTrust()
	}
}

/**
 * Process a pending permission request for a session.
 *
 * This function coordinates the permission flow:
 * 1. Checks if the operation is already auto-approved
 * 2. If not, requests permission from the ACP client
 * 3. Tracks "always allow" decisions
 * 4. Returns the translated result for Codemarie
 *
 * @param requestPermission - Function to request permission from the ACP client
 * @param sessionId - The session ID
 * @param toolCall - The tool call requiring permission
 * @param askType - The Codemarie ask type
 * @param identifier - Identifier for auto-approval tracking
 * @param autoApprovalTracker - The auto-approval tracker
 * @returns The permission handler result
 */
export async function processPermissionRequest(
	requestPermission: (
		sessionId: string,
		toolCall: acp.ToolCall,
		options: acp.PermissionOption[],
	) => Promise<acp.RequestPermissionResponse>,
	sessionId: string,
	toolCall: acp.ToolCall,
	askType: CodemarieAsk,
	identifier: string,
	autoApprovalTracker?: AutoApprovalTracker,
): Promise<PermissionHandlerResult> {
	// Check if already auto-approved
	if (autoApprovalTracker?.isAutoApproved(askType, identifier)) {
		return {
			response: "yesButtonClicked",
			alwaysAllow: true,
		}
	}

	// Get permission options for this ask type
	const options = getPermissionOptionsForAskType(askType)
	if (!options) {
		// No permission options defined - allow by default
		return {
			response: "yesButtonClicked",
		}
	}

	// Request permission from the client
	const response = await requestPermission(sessionId, toolCall, options)

	// Handle the response
	const result = handlePermissionResponse(response, askType)

	// Track "always allow" decisions
	if (result.alwaysAllow && autoApprovalTracker) {
		autoApprovalTracker.recordAlwaysAllow(askType, identifier)
	}

	return result
}

/**
 * Get the identifier for auto-approval tracking from a tool call.
 *
 * @param toolCall - The ACP tool call
 * @param askType - The Codemarie ask type
 * @returns The identifier string for auto-approval tracking
 */
export function getAutoApprovalIdentifier(toolCall: acp.ToolCall, askType: CodemarieAsk): string {
	const rawInput = toolCall.rawInput as Record<string, unknown> | undefined

	switch (askType) {
		case "command":
			return (rawInput?.command as string) || toolCall.title

		case "tool":
			// Try to get tool name from raw input or title
			return (rawInput?.tool as string) || toolCall.title

		case "use_mcp_server":
			return (rawInput?.serverName as string) || toolCall.title

		default:
			return toolCall.toolCallId
	}
}

/**
 * Update the session state's pending tool call after permission is handled.
 *
 * @param sessionState - The session state to update
 * @param toolCallId - The tool call ID that was handled
 * @param approved - Whether the permission was approved
 */
export function updateSessionStateAfterPermission(sessionState: AcpSessionState, toolCallId: string, approved: boolean): void {
	// Remove from pending tool calls
	sessionState.pendingToolCalls.delete(toolCallId)

	// Clear current tool call ID if it matches
	if (sessionState.currentToolCallId === toolCallId && !approved) {
		sessionState.currentToolCallId = undefined
	}
}
