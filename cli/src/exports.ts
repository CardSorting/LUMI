/**
 * Codemarie Library Exports
 *
 * This file exports the public API for programmatic use of Codemarie.
 * Use these classes and types to embed Codemarie into your applications.
 *
 * @example
 * ```typescript
 * import { CodemarieAgent } from "codemarie"
 *
 * const agent = new CodemarieAgent()
 * await agent.initialize({ clientCapabilities: {} })
 * const session = await agent.newSession({ cwd: process.cwd() })
 * ```
 * @module codemarie
 */

export { CodemarieAgent } from "./agent/CodemarieAgent.js"
export { CodemarieSessionEmitter } from "./agent/CodemarieSessionEmitter.js"
export type {
	AcpAgentOptions,
	AcpSessionState,
	AcpSessionStatus,
	Agent,
	AgentSideConnection,
	AudioContent,
	CancelNotification,
	ClientCapabilities,
	CodemarieAcpSession,
	CodemarieAgentCapabilities,
	CodemarieAgentInfo,
	CodemarieAgentOptions,
	CodemariePermissionOption,
	CodemarieSessionEvents,
	ContentBlock,
	ImageContent,
	InitializeRequest,
	InitializeResponse,
	LoadSessionRequest,
	LoadSessionResponse,
	McpServer,
	ModelInfo,
	NewSessionRequest,
	NewSessionResponse,
	PermissionHandler,
	PermissionOption,
	PermissionOptionKind,
	PromptRequest,
	PromptResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionModelState,
	SessionNotification,
	SessionUpdate,
	SessionUpdatePayload,
	SessionUpdateType,
	SetSessionConfigOptionRequest,
	SetSessionConfigOptionResponse,
	SetSessionModelRequest,
	SetSessionModelResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
	StopReason,
	TextContent,
	ToolCall,
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
	TranslatedMessage,
} from "./agent/public-types.js"
