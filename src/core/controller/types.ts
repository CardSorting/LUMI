import type { Anthropic } from "@anthropic-ai/sdk"
import { SpiderEngine } from "@core/policy/spider/SpiderEngine"
import { StateManager } from "@core/storage/StateManager"
import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import type { ModelInfo } from "@shared/api"
import { ChatContent } from "@shared/ChatContent"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog } from "@shared/mcp"
import { type Settings } from "@shared/storage/state-keys"
import { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { DietCodeAccountService } from "@/services/account/DietCodeAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { McpHub } from "@/services/mcp/McpHub"
import { DietCodeExtensionContext } from "@/shared/dietcode"
import { Task } from "../task"
import { TaskState } from "../task/TaskState"

/**
 * IController is the handler-facing port for the application controller.
 *
 * WHY THIS EXISTS (Dependency Inversion / Ports & Adapters):
 * The ~44 controller sub-handlers (controller/{mcp,models,state,ui,...}/*) and
 * the gRPC transport seam should depend on this ABSTRACTION, never on the
 * concrete `Controller` class in `./index`. Importing the concrete class from
 * the barrel forms a cycle: index.ts → handler → index.ts.
 *
 * CONTRACT COMPLETENESS:
 * This interface enumerates every `Controller` member touched by handlers,
 * services (e.g. AuthService), and the generated transport registry, derived
 * from actual usage. The concrete `Controller` (in ./index) declares
 * `implements IController`, so `tsc` guarantees the two stay in sync — if a new
 * handler needs a member, add it here and the compiler enforces the rest.
 *
 * DO NOT import the concrete `Controller` into transport/handler code; depend
 * on `IController` so the static dependency graph stays acyclic.
 */
export interface IController {
	// ─── Properties ───
	readonly context: DietCodeExtensionContext
	task?: Task
	readonly stateManager: StateManager
	mcpHub: McpHub
	accountService: DietCodeAccountService
	authService: AuthService
	ocaAuthService: OcaAuthService

	// ─── Lifecycle / task management ───
	getSpiderEngine(): Promise<SpiderEngine>
	createTask(prompt: string): Promise<string>
	initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
		initialTaskState?: Partial<TaskState>,
	): Promise<string>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}>
	exportTaskWithId(id: string): Promise<void>
	deleteTaskFromState(id: string): Promise<HistoryItem[]>

	// ─── Mode / settings ───
	updateBackgroundCommandState(isRunning: boolean, taskId?: string): void
	toggleActModeForYoloMode(): Promise<boolean>
	switchToPlanModeForAgent(): Promise<boolean>
	togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean>
	updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void>

	// ─── Webview state ───
	postStateToWebview(): Promise<void>
	getStateToPostToWebview(): Promise<ExtensionState>

	// ─── Workspace / models / marketplace ───
	ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined>
	readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined>
	refreshMcpMarketplace(sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined>

	// ─── Auth ───
	handleSignOut(): Promise<void>
	handleOcaSignOut(): Promise<void>
}
