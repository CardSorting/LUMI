import {
	CodemarieAsk as AppCodemarieAsk,
	CodemarieMessage as AppCodemarieMessage,
	CodemarieSay as AppCodemarieSay,
} from "@shared/ExtensionMessage"
import {
	CodemarieAsk,
	CodemarieMessageType,
	CodemarieSay,
	CodemarieMessage as ProtoCodemarieMessage,
} from "@shared/proto/codemarie/ui"

// Helper function to convert CodemarieAsk string to enum
function convertCodemarieAskToProtoEnum(ask: AppCodemarieAsk | undefined): CodemarieAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppCodemarieAsk, CodemarieAsk> = {
		followup: CodemarieAsk.FOLLOWUP,
		plan_mode_respond: CodemarieAsk.PLAN_MODE_RESPOND,
		act_mode_respond: CodemarieAsk.ACT_MODE_RESPOND,
		command: CodemarieAsk.COMMAND,
		command_output: CodemarieAsk.COMMAND_OUTPUT,
		completion_result: CodemarieAsk.COMPLETION_RESULT,
		tool: CodemarieAsk.TOOL,
		api_req_failed: CodemarieAsk.API_REQ_FAILED,
		resume_task: CodemarieAsk.RESUME_TASK,
		resume_completed_task: CodemarieAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: CodemarieAsk.MISTAKE_LIMIT_REACHED,
		browser_action_launch: CodemarieAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: CodemarieAsk.USE_MCP_SERVER,
		new_task: CodemarieAsk.NEW_TASK,
		condense: CodemarieAsk.CONDENSE,
		summarize_task: CodemarieAsk.SUMMARIZE_TASK,
		report_bug: CodemarieAsk.REPORT_BUG,
		use_subagents: CodemarieAsk.USE_SUBAGENTS,
	}

	const result = mapping[ask]
	if (result === undefined) {
	}
	return result
}

// Helper function to convert CodemarieAsk enum to string
function convertProtoEnumToCodemarieAsk(ask: CodemarieAsk): AppCodemarieAsk | undefined {
	if (ask === CodemarieAsk.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<CodemarieAsk, CodemarieAsk.UNRECOGNIZED>, AppCodemarieAsk> = {
		[CodemarieAsk.FOLLOWUP]: "followup",
		[CodemarieAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[CodemarieAsk.ACT_MODE_RESPOND]: "act_mode_respond",
		[CodemarieAsk.COMMAND]: "command",
		[CodemarieAsk.COMMAND_OUTPUT]: "command_output",
		[CodemarieAsk.COMPLETION_RESULT]: "completion_result",
		[CodemarieAsk.TOOL]: "tool",
		[CodemarieAsk.API_REQ_FAILED]: "api_req_failed",
		[CodemarieAsk.RESUME_TASK]: "resume_task",
		[CodemarieAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[CodemarieAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[CodemarieAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[CodemarieAsk.USE_MCP_SERVER]: "use_mcp_server",
		[CodemarieAsk.NEW_TASK]: "new_task",
		[CodemarieAsk.CONDENSE]: "condense",
		[CodemarieAsk.SUMMARIZE_TASK]: "summarize_task",
		[CodemarieAsk.REPORT_BUG]: "report_bug",
		[CodemarieAsk.USE_SUBAGENTS]: "use_subagents",
	}

	return mapping[ask]
}

// Helper function to convert CodemarieSay string to enum
function convertCodemarieSayToProtoEnum(say: AppCodemarieSay | undefined): CodemarieSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppCodemarieSay, CodemarieSay> = {
		task: CodemarieSay.TASK,
		error: CodemarieSay.ERROR,
		api_req_started: CodemarieSay.API_REQ_STARTED,
		api_req_finished: CodemarieSay.API_REQ_FINISHED,
		text: CodemarieSay.TEXT,
		reasoning: CodemarieSay.REASONING,
		completion_result: CodemarieSay.COMPLETION_RESULT_SAY,
		user_feedback: CodemarieSay.USER_FEEDBACK,
		user_feedback_diff: CodemarieSay.USER_FEEDBACK_DIFF,
		api_req_retried: CodemarieSay.API_REQ_RETRIED,
		command: CodemarieSay.COMMAND_SAY,
		command_output: CodemarieSay.COMMAND_OUTPUT_SAY,
		tool: CodemarieSay.TOOL_SAY,
		shell_integration_warning: CodemarieSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: CodemarieSay.SHELL_INTEGRATION_WARNING,
		browser_action_launch: CodemarieSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: CodemarieSay.BROWSER_ACTION,
		browser_action_result: CodemarieSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: CodemarieSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: CodemarieSay.MCP_SERVER_RESPONSE,
		mcp_notification: CodemarieSay.MCP_NOTIFICATION,
		use_mcp_server: CodemarieSay.USE_MCP_SERVER_SAY,
		diff_error: CodemarieSay.DIFF_ERROR,
		deleted_api_reqs: CodemarieSay.DELETED_API_REQS,
		codemarieignore_error: CodemarieSay.CODEMARIEIGNORE_ERROR,
		command_permission_denied: CodemarieSay.COMMAND_PERMISSION_DENIED,
		checkpoint_created: CodemarieSay.CHECKPOINT_CREATED,
		load_mcp_documentation: CodemarieSay.LOAD_MCP_DOCUMENTATION,
		info: CodemarieSay.INFO,
		task_progress: CodemarieSay.TASK_PROGRESS,
		error_retry: CodemarieSay.ERROR_RETRY,
		hook_status: CodemarieSay.HOOK_STATUS,
		hook_output_stream: CodemarieSay.HOOK_OUTPUT_STREAM,
		conditional_rules_applied: CodemarieSay.CONDITIONAL_RULES_APPLIED,
		subagent: CodemarieSay.SUBAGENT_STATUS,
		use_subagents: CodemarieSay.USE_SUBAGENTS_SAY,
		subagent_usage: CodemarieSay.SUBAGENT_USAGE,
		generate_explanation: CodemarieSay.GENERATE_EXPLANATION,
	}

	const result = mapping[say]

	return result
}

// Helper function to convert CodemarieSay enum to string
function convertProtoEnumToCodemarieSay(say: CodemarieSay): AppCodemarieSay | undefined {
	if (say === CodemarieSay.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<CodemarieSay, CodemarieSay.UNRECOGNIZED>, AppCodemarieSay> = {
		[CodemarieSay.TASK]: "task",
		[CodemarieSay.ERROR]: "error",
		[CodemarieSay.API_REQ_STARTED]: "api_req_started",
		[CodemarieSay.API_REQ_FINISHED]: "api_req_finished",
		[CodemarieSay.TEXT]: "text",
		[CodemarieSay.REASONING]: "reasoning",
		[CodemarieSay.COMPLETION_RESULT_SAY]: "completion_result",
		[CodemarieSay.USER_FEEDBACK]: "user_feedback",
		[CodemarieSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[CodemarieSay.API_REQ_RETRIED]: "api_req_retried",
		[CodemarieSay.COMMAND_SAY]: "command",
		[CodemarieSay.COMMAND_OUTPUT_SAY]: "command_output",
		[CodemarieSay.TOOL_SAY]: "tool",
		[CodemarieSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[CodemarieSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[CodemarieSay.BROWSER_ACTION]: "browser_action",
		[CodemarieSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[CodemarieSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[CodemarieSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[CodemarieSay.MCP_NOTIFICATION]: "mcp_notification",
		[CodemarieSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[CodemarieSay.DIFF_ERROR]: "diff_error",
		[CodemarieSay.DELETED_API_REQS]: "deleted_api_reqs",
		[CodemarieSay.CODEMARIEIGNORE_ERROR]: "codemarieignore_error",
		[CodemarieSay.COMMAND_PERMISSION_DENIED]: "command_permission_denied",
		[CodemarieSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[CodemarieSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[CodemarieSay.INFO]: "info",
		[CodemarieSay.TASK_PROGRESS]: "task_progress",
		[CodemarieSay.ERROR_RETRY]: "error_retry",
		[CodemarieSay.GENERATE_EXPLANATION]: "generate_explanation",
		[CodemarieSay.HOOK_STATUS]: "hook_status",
		[CodemarieSay.HOOK_OUTPUT_STREAM]: "hook_output_stream",
		[CodemarieSay.CONDITIONAL_RULES_APPLIED]: "conditional_rules_applied",
		[CodemarieSay.SUBAGENT_STATUS]: "subagent",
		[CodemarieSay.USE_SUBAGENTS_SAY]: "use_subagents",
		[CodemarieSay.SUBAGENT_USAGE]: "subagent_usage",
	}

	return mapping[say]
}

/**
 * Convert application CodemarieMessage to proto CodemarieMessage
 */
export function convertCodemarieMessageToProto(message: AppCodemarieMessage): ProtoCodemarieMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertCodemarieAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertCodemarieSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: CodemarieAsk = CodemarieAsk.FOLLOWUP // Proto default
	let finalSayEnum: CodemarieSay = CodemarieSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? CodemarieAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? CodemarieSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoCodemarieMessage = {
		ts: message.ts,
		type: message.type === "ask" ? CodemarieMessageType.ASK : CodemarieMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		lastCheckpointHash: message.lastCheckpointHash ?? "",
		isCheckpointCheckedOut: message.isCheckpointCheckedOut ?? false,
		isOperationOutsideWorkspace: message.isOperationOutsideWorkspace ?? false,
		conversationHistoryIndex: message.conversationHistoryIndex ?? 0,
		conversationHistoryDeletedRange: message.conversationHistoryDeletedRange
			? {
					startIndex: message.conversationHistoryDeletedRange[0],
					endIndex: message.conversationHistoryDeletedRange[1],
				}
			: undefined,
		// Additional optional fields for specific ask/say types
		sayTool: undefined,
		sayBrowserAction: undefined,
		browserActionResult: undefined,
		askUseMcpServer: undefined,
		planModeResponse: undefined,
		askQuestion: undefined,
		askNewTask: undefined,
		apiReqInfo: undefined,
		modelInfo: message.modelInfo ?? undefined,
	}

	return protoMessage
}

/**
 * Convert proto CodemarieMessage to application CodemarieMessage
 */
export function convertProtoToCodemarieMessage(protoMessage: ProtoCodemarieMessage): AppCodemarieMessage {
	const message: AppCodemarieMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === CodemarieMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === CodemarieMessageType.ASK) {
		const ask = convertProtoEnumToCodemarieAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === CodemarieMessageType.SAY) {
		const say = convertProtoEnumToCodemarieSay(protoMessage.say)
		if (say !== undefined) {
			message.say = say
		}
	}

	// Convert other fields - preserve empty strings as they may be intentional
	if (protoMessage.text !== "") {
		message.text = protoMessage.text
	}
	if (protoMessage.reasoning !== "") {
		message.reasoning = protoMessage.reasoning
	}
	if (protoMessage.images.length > 0) {
		message.images = protoMessage.images
	}
	if (protoMessage.files.length > 0) {
		message.files = protoMessage.files
	}
	if (protoMessage.partial) {
		message.partial = protoMessage.partial
	}
	if (protoMessage.lastCheckpointHash !== "") {
		message.lastCheckpointHash = protoMessage.lastCheckpointHash
	}
	if (protoMessage.isCheckpointCheckedOut) {
		message.isCheckpointCheckedOut = protoMessage.isCheckpointCheckedOut
	}
	if (protoMessage.isOperationOutsideWorkspace) {
		message.isOperationOutsideWorkspace = protoMessage.isOperationOutsideWorkspace
	}
	if (protoMessage.conversationHistoryIndex !== 0) {
		message.conversationHistoryIndex = protoMessage.conversationHistoryIndex
	}

	// Convert conversationHistoryDeletedRange from object to tuple
	if (protoMessage.conversationHistoryDeletedRange) {
		message.conversationHistoryDeletedRange = [
			protoMessage.conversationHistoryDeletedRange.startIndex,
			protoMessage.conversationHistoryDeletedRange.endIndex,
		]
	}

	return message
}
