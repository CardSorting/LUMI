/**
 * DietCode Library Exports
 *
 * This file exports the public API for programmatic use of DietCode.
 * Use these classes and types to embed DietCode into your applications.
 *
 * @example
 * ```typescript
 * import { DietCodeAgent } from "dietcode"
 *
 * const agent = new DietCodeAgent()
 * await agent.initialize({ clientCapabilities: {} })
 * const session = await agent.newSession({ cwd: process.cwd() })
 * ```
 * @module dietcode
 */

export { DietCodeAgent } from "./agent/DietCodeAgent.js"
export { DietCodeSessionEmitter } from "./agent/DietCodeSessionEmitter.js"
export type {
	AcpAgentOptions,
	AcpSessionState,
	AcpSessionStatus,
	Agent,
	AgentSideConnection,
	AudioContent,
	CancelNotification,
	ClientCapabilities,
	ContentBlock,
	DietCodeAcpSession,
	DietCodeAgentCapabilities,
	DietCodeAgentInfo,
	DietCodeAgentOptions,
	DietCodePermissionOption,
	DietCodeSessionEvents,
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
