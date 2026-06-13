/**
 * Terminal command execution shared by the VS Code extension runtime.
 */

// Export unified command executor
export { CommandExecutor } from "./CommandExecutor"

// Export command orchestrator (shared logic)
export { findLastIndex, orchestrateCommandExecution } from "./CommandOrchestrator"

// Export all types from types.ts
export type {
	// Command Executor types
	AskResponse,
	CommandExecutionOptions,
	CommandExecutorCallbacks,
	CommandExecutorConfig,
	FullCommandExecutorConfig,
	// Terminal types
	ITerminal,
	ITerminalManager,
	ITerminalProcess,
	ITerminalProcessResult,
	// Command Orchestrator types
	OrchestrationOptions,
	OrchestrationResult,
	TerminalInfo,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "./types"
