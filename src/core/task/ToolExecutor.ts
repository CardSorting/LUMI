import { ApiHandler } from "@core/api"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { DietCodeIgnoreController } from "@core/ignore/DietCodeIgnoreController"
import { CommandPermissionController } from "@core/permissions"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type { CommandExecutionOptions } from "@integrations/terminal"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { DietCodeAsk, DietCodeSay } from "@shared/ExtensionMessage"
import { DietCodeContent } from "@shared/messages/content"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool, toolUseNames } from "@shared/tools"
import { DietCodeAskResponse } from "@shared/WebviewMessage"
import * as path from "path"
import { isParallelToolCallingEnabled, modelDoesntSupportWebp } from "@/utils/model-utils"
import { ToolUse } from "../assistant-message"
import { ContextManager } from "../context/context-management/ContextManager"
import { KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { formatResponse } from "../prompts/responses"
import { StateManager } from "../storage/StateManager"
import { WorkspaceRootManager } from "../workspace"
import { ToolResponse } from "."
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"
import { canonicalizeAttemptCompletionParams, checkCompletionGateCircuitBreaker } from "./tools/attemptCompletionUtils"
import { AutoApprove } from "./tools/autoApprove"
import {
	shouldBypassGuardForParentIoTool,
	shouldCloseBrowserBetweenTools,
	shouldDeferParentGuardPostExecution,
	shouldSkipLayerInjectionForParentIoTool,
	shouldUseIoAuthorityReadFastPath,
} from "./tools/executionAuthority"
import { buildIoCoalesceKey, getIoRequestCoalescer } from "./tools/io/IoRequestCoalescer"
import { acquireParentIoSlot } from "./tools/io/ParentIoBulkhead"
import { RefactorHealer } from "./tools/RefactorHealer"
import { IPartialBlockHandler, ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { ToolValidator } from "./tools/ToolValidator"
import { TaskConfig, validateTaskConfig } from "./tools/types/TaskConfig"
import { createUIHelpers } from "./tools/types/UIHelpers"
import { ToolDisplayUtils } from "./tools/utils/ToolDisplayUtils"
import { ToolResultUtils } from "./tools/utils/ToolResultUtils"

export { canonicalizeAttemptCompletionParams } from "./tools/attemptCompletionUtils"

import { ReactivePolicyObserver } from "../policy/ReactivePolicyObserver"
import { UniversalGuard } from "../policy/UniversalGuard"

export class ToolExecutor {
	private autoApprover: AutoApprove
	private coordinator: ToolExecutorCoordinator
	private policyObserver: ReactivePolicyObserver
	private guard: UniversalGuard
	private healer: RefactorHealer
	private cachedToolConfig?: TaskConfig
	private cachedToolConfigKey?: string
	private knowledgeGraphServicePromise?: Promise<KnowledgeGraphService | undefined>

	public resetSystemPressure(): void {
		if (this.guard) {
			this.guard.resetSystemPressure()
		}
	}

	public getSystemDiagnostics(): string {
		return this.guard ? this.guard.getSystemDiagnostics() : ""
	}

	public getGuard(): UniversalGuard {
		return this.guard
	}

	// Auto-approval methods using the AutoApprove class
	private shouldAutoApproveTool(toolName: DietCodeDefaultTool): boolean | [boolean, boolean] {
		return this.autoApprover.shouldAutoApproveTool(toolName)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: DietCodeDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		return this.autoApprover.shouldAutoApproveToolWithPath(blockname, autoApproveActionpath)
	}

	constructor(
		// Core Services & Managers
		private taskState: TaskState,
		private messageStateHandler: MessageStateHandler,
		private api: ApiHandler,
		private urlContentFetcher: UrlContentFetcher,
		private browserSession: BrowserSession,
		private diffViewProvider: DiffViewProvider,
		private mcpHub: McpHub,
		private fileContextTracker: FileContextTracker,
		private dietcodeIgnoreController: DietCodeIgnoreController,
		private commandPermissionController: CommandPermissionController,
		private contextManager: ContextManager,
		private stateManager: StateManager,
		private cwd: string,
		private taskId: string,
		private ulid: string,
		private vscodeTerminalExecutionMode: "vscodeTerminal",
		private workspaceManager: WorkspaceRootManager | undefined,
		private isMultiRootEnabled: boolean,
		private say: (
			type: DietCodeSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
		) => Promise<number | undefined>,
		private ask: (
			type: DietCodeAsk,
			text?: string,
			partial?: boolean,
		) => Promise<{ response: DietCodeAskResponse; text?: string; images?: string[] }>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>,
		private sayAndCreateMissingParamError: (
			toolName: DietCodeDefaultTool,
			paramName: string,
			relPath?: string,
		) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (
			type: "ask" | "say",
			askOrSay: DietCodeAsk | DietCodeSay,
		) => Promise<void>,
		private executeCommandTool: (
			command: string,
			timeoutSeconds: number | undefined,
			options?: CommandExecutionOptions,
		) => Promise<[boolean, any]>,
		private cancelRunningCommandTool: () => Promise<boolean>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>,
		private switchToActMode: () => Promise<boolean>,
		private switchToPlanMode: () => Promise<boolean>,
		private cancelTask: () => Promise<void>,
		private setActiveHookExecution: (hookExecution: NonNullable<typeof taskState.activeHookExecution>) => Promise<void>,
		private clearActiveHookExecution: () => Promise<void>,
		private getActiveHookExecution: () => Promise<typeof taskState.activeHookExecution>,
		private runUserPromptSubmitHook: (
			userContent: DietCodeContent[],
			context: "initial_task" | "resume" | "feedback",
		) => Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }>,
		private getKnowledgeGraphService: () => Promise<KnowledgeGraphService | undefined>,
	) {
		this.autoApprover = new AutoApprove(this.stateManager)
		this.guard = new UniversalGuard(cwd, taskId, this.stateManager)
		this.policyObserver = new ReactivePolicyObserver(this.guard as any) // Guard wraps engine
		this.healer = new RefactorHealer(this.cwd)
		this.coordinator = new ToolExecutorCoordinator()
		this.registerToolHandlers()
	}

	// Create a properly typed TaskConfig object for handlers
	// NOTE: modifying this object in the tool handlers is okay since these are all references to the singular ToolExecutor instance's variables. However, be careful modifying this object assuming it will update the ToolExecutor instance, e.g. config.browserSession = ... will not update the ToolExecutor.browserSession instance variable. Use applyLatestBrowserSettings() instead.
	private getToolConfigCacheKey(): string {
		return `${this.stateManager.getGlobalSettingsKey("mode")}|${this.isParallelToolCallingEnabled()}`
	}

	/** Refresh volatile TaskConfig fields on cache hit — taskState reference stays live. */
	private refreshCachedToolConfig(config: TaskConfig): void {
		config.mode = this.stateManager.getGlobalSettingsKey("mode")
		config.strictPlanModeEnabled = this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled")
		config.yoloModeToggled = this.stateManager.getGlobalSettingsKey("yoloModeToggled")
		config.doubleCheckCompletionEnabled = this.stateManager.getGlobalSettingsKey("doubleCheckCompletionEnabled")
		config.auditCompletionGateEnabled = this.stateManager.getGlobalSettingsKey("auditCompletionGateEnabled")
		config.auditCompletionGateThreshold = this.stateManager.getGlobalSettingsKey("auditCompletionGateThreshold")
		config.auditCompletionGateCriticalOnly = this.stateManager.getGlobalSettingsKey("auditCompletionGateCriticalOnly")
		config.auditActModeAdvisoryEnabled = this.stateManager.getGlobalSettingsKey("auditActModeAdvisoryEnabled")
		config.auditAdvisoryEscalationEnabled = this.stateManager.getGlobalSettingsKey("auditAdvisoryEscalationEnabled")
		config.auditPlanRegressionGateEnabled = this.stateManager.getGlobalSettingsKey("auditPlanRegressionGateEnabled")
		config.auditToolOutputAdvisoryEnabled = this.stateManager.getGlobalSettingsKey("auditToolOutputAdvisoryEnabled")
		config.auditFileWriteAdvisoryEnabled = this.stateManager.getGlobalSettingsKey("auditFileWriteAdvisoryEnabled")
		config.auditIntentThresholdAdjustmentsEnabled = this.stateManager.getGlobalSettingsKey(
			"auditIntentThresholdAdjustmentsEnabled",
		)
		config.auditIntentThresholdOverrides = this.stateManager.getGlobalSettingsKey("auditIntentThresholdOverrides")
		config.auditSarifHookExportEnabled = this.stateManager.getGlobalSettingsKey("auditSarifHookExportEnabled")
		config.auditWorkspaceArtifactsEnabled = this.stateManager.getGlobalSettingsKey("auditWorkspaceArtifactsEnabled")
		config.enableParallelToolCalling = this.isParallelToolCallingEnabled()
		config.autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		config.browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		config.focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
	}

	private async getKnowledgeGraphServiceCached(): Promise<KnowledgeGraphService | undefined> {
		if (!this.knowledgeGraphServicePromise) {
			this.knowledgeGraphServicePromise = this.getKnowledgeGraphService()
		}
		return this.knowledgeGraphServicePromise
	}

	private async asToolConfig(): Promise<TaskConfig> {
		const cacheKey = this.getToolConfigCacheKey()
		if (this.cachedToolConfig && this.cachedToolConfigKey === cacheKey) {
			this.refreshCachedToolConfig(this.cachedToolConfig)
			return this.cachedToolConfig
		}

		const kgService = await this.getKnowledgeGraphServiceCached()
		if (!kgService) {
			throw new Error("KnowledgeGraphService not initialized")
		}

		const config: TaskConfig = {
			taskId: this.taskId,
			ulid: this.ulid,
			mode: this.stateManager.getGlobalSettingsKey("mode"),
			strictPlanModeEnabled: this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			doubleCheckCompletionEnabled: this.stateManager.getGlobalSettingsKey("doubleCheckCompletionEnabled"),
			auditCompletionGateEnabled: this.stateManager.getGlobalSettingsKey("auditCompletionGateEnabled"),
			auditCompletionGateThreshold: this.stateManager.getGlobalSettingsKey("auditCompletionGateThreshold"),
			auditCompletionGateCriticalOnly: this.stateManager.getGlobalSettingsKey("auditCompletionGateCriticalOnly"),
			auditActModeAdvisoryEnabled: this.stateManager.getGlobalSettingsKey("auditActModeAdvisoryEnabled"),
			auditAdvisoryEscalationEnabled: this.stateManager.getGlobalSettingsKey("auditAdvisoryEscalationEnabled"),
			auditPlanRegressionGateEnabled: this.stateManager.getGlobalSettingsKey("auditPlanRegressionGateEnabled"),
			auditToolOutputAdvisoryEnabled: this.stateManager.getGlobalSettingsKey("auditToolOutputAdvisoryEnabled"),
			auditFileWriteAdvisoryEnabled: this.stateManager.getGlobalSettingsKey("auditFileWriteAdvisoryEnabled"),
			auditIntentThresholdAdjustmentsEnabled: this.stateManager.getGlobalSettingsKey(
				"auditIntentThresholdAdjustmentsEnabled",
			),
			auditIntentThresholdOverrides: this.stateManager.getGlobalSettingsKey("auditIntentThresholdOverrides"),
			auditSarifHookExportEnabled: this.stateManager.getGlobalSettingsKey("auditSarifHookExportEnabled"),
			auditWorkspaceArtifactsEnabled: this.stateManager.getGlobalSettingsKey("auditWorkspaceArtifactsEnabled"),
			vscodeTerminalExecutionMode: this.vscodeTerminalExecutionMode,
			enableParallelToolCalling: this.isParallelToolCallingEnabled(),
			isSubagentExecution: false,
			finalizationMode: false,
			cwd: this.cwd,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.isMultiRootEnabled,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.stateManager.getGlobalSettingsKey("autoApprovalSettings"),
			autoApprover: this.autoApprover,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				dietcodeIgnoreController: this.dietcodeIgnoreController,
				commandPermissionController: this.commandPermissionController,
				contextManager: this.contextManager,
				stateManager: this.stateManager,
				knowledgeGraphService: kgService,
			},
			callbacks: {
				say: this.say,
				ask: this.ask,
				saveCheckpoint: this.saveCheckpoint,
				postStateToWebview: async () => {},
				reinitExistingTaskFromId: async () => {},
				cancelTask: this.cancelTask,
				updateTaskHistory: async () => [],
				executeCommandTool: this.executeCommandTool,
				cancelRunningCommandTool: this.cancelRunningCommandTool,
				doesLatestTaskCompletionHaveNewChanges: this.doesLatestTaskCompletionHaveNewChanges,
				updateFCListFromToolResponse: this.updateFCListFromToolResponse,
				sayAndCreateMissingParamError: this.sayAndCreateMissingParamError,
				removeLastPartialMessageIfExistsWithType: this.removeLastPartialMessageIfExistsWithType,
				shouldAutoApproveTool: this.shouldAutoApproveTool.bind(this),
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
				applyLatestBrowserSettings: this.applyLatestBrowserSettings.bind(this),
				switchToActMode: this.switchToActMode,
				switchToPlanMode: this.switchToPlanMode,
				setActiveHookExecution: this.setActiveHookExecution,
				clearActiveHookExecution: this.clearActiveHookExecution,
				getActiveHookExecution: this.getActiveHookExecution,
				runUserPromptSubmitHook: this.runUserPromptSubmitHook,
			},
			coordinator: this.coordinator,
			universalGuard: this.guard,
		}

		// Validate the config at runtime to catch any missing properties
		validateTaskConfig(config)

		const configWithSession = config as TaskConfig & { getSessionStreamId?: () => string }
		configWithSession.getSessionStreamId = () => this.taskId

		this.cachedToolConfig = configWithSession
		this.cachedToolConfigKey = cacheKey
		return configWithSession
	}

	/**
	 * Register all tool handlers with the coordinator
	 */
	private registerToolHandlers(): void {
		const validator = new ToolValidator(this.dietcodeIgnoreController, this.guard as any)
		// Register all tools via toolUseNames
		for (const tool of toolUseNames) {
			this.coordinator.registerByName(tool, validator)
		}
	}

	/**
	 * Main entry point for tool execution - called by Task class
	 */
	public async executeTool(block: ToolUse): Promise<void> {
		await this.execute(block)
	}

	/**
	 * Updates the browser settings
	 */
	public async applyLatestBrowserSettings() {
		await this.browserSession.dispose()
		const apiHandlerModel = this.api.getModel()
		const useWebp = this.api ? !modelDoesntSupportWebp(apiHandlerModel) : true
		this.browserSession = new BrowserSession(this.stateManager, useWebp)
		return this.browserSession
	}

	/**
	 * Handles errors during tool execution.
	 *
	 * Logs the error, displays it to the user via the UI, and adds an error
	 * result to the conversation context so the AI can see what went wrong.
	 *
	 * @param action Description of what was being attempted (e.g., "executing read_file")
	 * @param error The error that occurred
	 * @param block The tool use block that caused the error
	 */
	private async handleError(action: string, error: Error, block: ToolUse): Promise<void> {
		const errorString = `Error ${action}: ${error.message}`
		await this.say("error", errorString)

		// Create error response for the tool
		const errorResponse = formatResponse.toolError(errorString)
		this.pushToolResult(errorResponse, block)
	}

	/**
	 * Pushes a tool result to the user message content.
	 *
	 * This is a critical method that:
	 * - Formats the tool result appropriately for the API
	 * - Adds it to the conversation context
	 * - Marks that a tool has been used in this turn
	 *
	 * @param content The tool response content to add
	 * @param block The tool use block that generated this result
	 */
	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		// Use the ToolResultUtils to properly format and push the tool result
		ToolResultUtils.pushToolResult(
			content,
			block,
			this.taskState.userMessageContent,
			(block: ToolUse) => ToolDisplayUtils.getToolDescription(block),
			this.coordinator,
			this.taskState.toolUseIdMap,
		)
		// Mark that a tool has been used (only matters when parallel tool calling is disabled)
		if (!this.isParallelToolCallingEnabled()) {
			this.taskState.didAlreadyUseTool = true
		}
	}

	/**
	}

	/**
	 * Check if parallel tool calling is enabled.
	 * Parallel tool calling is enabled if:
	 * 1. User has enabled it in settings, OR
	 * 2. The current model/provider supports native tool calling and handles parallel tools well
	 */
	private isParallelToolCallingEnabled(): boolean {
		const enableParallelSetting = this.stateManager.getGlobalSettingsKey("enableParallelToolCalling")
		const model = this.api.getModel()
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const providerId = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		return isParallelToolCallingEnabled(enableParallelSetting, { providerId, model, mode })
	}

	/**
	 * Tools that are restricted in plan mode and can only be used in act mode
	 */
	private static readonly PLAN_MODE_RESTRICTED_TOOLS: DietCodeDefaultTool[] = [
		DietCodeDefaultTool.FILE_NEW,
		DietCodeDefaultTool.FILE_EDIT,
		DietCodeDefaultTool.NEW_RULE,
		DietCodeDefaultTool.APPLY_PATCH,
	]

	/**
	 * Execute a tool through the coordinator if it's registered.
	 *
	 * This is the main entry point for tool execution, called by the Task class.
	 * It handles:
	 * - Checking if the tool is registered with the coordinator
	 * - Validating tool execution is allowed (not rejected, not already used, etc.)
	 * - Enforcing plan mode restrictions on file modification tools
	 * - Delegating to partial or complete block handlers
	 * - Error handling and checkpointing
	 *
	 * @param block The tool use block to execute
	 * @returns true if the tool was handled (even if execution failed), false if not registered
	 */
	private async execute(block: ToolUse): Promise<boolean> {
		// Note: MCP tool name transformation happens earlier in ToolUseHandler.getPartialToolUsesAsContent()
		// The toolUseIdMap is updated at the point of transformation in index.ts

		if (!this.coordinator.has(block.name)) {
			return false // Tool not handled by coordinator
		}
		canonicalizeAttemptCompletionParams(block)

		const config = await this.asToolConfig()

		if (block.name === DietCodeDefaultTool.ATTEMPT && !block.partial) {
			const breakerResult = checkCompletionGateCircuitBreaker(config)
			if (breakerResult) {
				this.pushToolResult(breakerResult, block)
				return true
			}
		}

		try {
			// Check if user rejected a previous tool
			if (this.taskState.didRejectTool) {
				const reason = block.partial
					? "Tool was interrupted and not executed due to user rejecting a previous tool."
					: "Skipping tool due to user rejecting a previous tool."
				this.createToolRejectionMessage(block, reason)
				return true
			}

			// Check if a tool has already been used in this message (only enforced when parallel tool calling is disabled)
			if (!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: formatResponse.toolAlreadyUsed(block.name),
				})
				return true
			}

			// Logic for plan-mode tool call restrictions
			if (
				this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled") &&
				this.stateManager.getGlobalSettingsKey("mode") === "plan" &&
				block.name
			) {
				const isNaturallyRestricted = this.isPlanModeToolRestricted(block.name)

				// Layer-Contextual Blocking: Prevent bypasses in DOMAIN and CORE layers during planning
				const params = block.params as any
				const { getTargetPath } = require("@/utils/joy-zoning")
				const targetPath = getTargetPath(params)
				let isLayerRestricted = false
				let layerHint = ""

				if (targetPath) {
					const layer = this.guard.getLayerForPath(targetPath)

					if (
						(layer === "domain" || layer === "core") &&
						(block.name === DietCodeDefaultTool.BASH || block.name === DietCodeDefaultTool.MCP_USE)
					) {
						isLayerRestricted = true
						const role = layer.toUpperCase()
						layerHint = `\n\nThis operation targets the **${role}** layer. To maintain architectural purity, direct execution or MCP interventions on ${role} logic are strictly forbidden during the PLANNING phase. Focus on:
- Mapping dependencies and interfaces.
- Defining contracts in Domain.
- Orchestration logic in Core (without side effects).`
					} else if (layer) {
						layerHint = `\n\nThis file belongs to the **${layer.toUpperCase()}** layer. While planning, consider:\n- What interfaces does this change need?\n- Which other layers will be affected?\n- Should domain logic be separated from infrastructure?`
					}
				}

				if (isNaturallyRestricted || isLayerRestricted) {
					const errorMessage = isLayerRestricted
						? `Tool '${block.name}' is temporarily restricted for this target in PLAN MODE.${layerHint}`
						: `Tool '${block.name}' is not available in PLAN MODE. The system will automatically transition to ACT MODE after you finalize your plan with plan_mode_respond.${layerHint}`

					await this.removeLastPartialMessageIfExistsWithType("say", "error")
					await this.say("error", errorMessage)

					if (!block.partial) {
						this.pushToolResult(formatResponse.toolError(errorMessage), block)
					}
					return true
				}
			}

			// Close browser for non-browser tools when a session is active
			if (shouldCloseBrowserBetweenTools(block.name, this.browserSession.hasActiveSession())) {
				void this.browserSession.closeBrowser().catch(() => undefined)
			}

			// Handle partial blocks
			if (block.partial) {
				await this.handlePartialBlock(block, config)
				return true
			}

			// Handle complete blocks
			await this.handleCompleteBlock(block, config)
			return true
		} catch (error) {
			await this.handleError(`executing ${block.name}`, error as Error, block)
			return true
		}
	}

	/**
	 * Check if a tool is restricted in plan mode.
	 *
	 * In strict plan mode, file modification tools (write_to_file, editedExistingFile, etc.)
	 * are blocked. The AI must switch to Act mode to use these tools.
	 *
	 * @param toolName The name of the tool to check
	 * @returns true if the tool is restricted in plan mode, false otherwise
	 */
	private isPlanModeToolRestricted(toolName: DietCodeDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	/**
	 * Create a tool rejection message and add it to user message content.
	 *
	 * Used when a tool cannot be executed (e.g., user rejected a previous tool,
	 * tool was interrupted, etc.). Adds a text message to the conversation explaining
	 * why the tool was not executed.
	 *
	 * @param block The tool use block that was rejected
	 * @param reason Human-readable explanation of why the tool was rejected
	 */
	private createToolRejectionMessage(block: ToolUse, reason: string): void {
		this.taskState.userMessageContent.push({
			type: "text",
			text: `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`,
		})
	}

	/**
	 * Adds hook context modification to the conversation if provided.
	 * Parses the context to extract type prefix and formats as XML.
	 *
	 * @param contextModification The context string from the hook output
	 * @param source The hook source name ("PreToolUse" or "PostToolUse")
	 */
	private addHookContextToConversation(contextModification: string | undefined, source: string): void {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		// Extract context type from first line if specified (e.g., "WORKSPACE_RULES: ...")
		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText

		// Check if first line specifies a type: "TYPE: content"
		const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
		const typeMatch = typeMatchRegex.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((l: string) => l.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		const hookContextBlock = {
			type: "text" as const,
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		}

		this.taskState.userMessageContent.push(hookContextBlock)
	}

	/**
	 * Runs the PostToolUse hook after tool execution.
	 * This is extracted from handleCompleteBlock to eliminate code duplication
	 * between success and error paths.
	 *
	 * @param block The tool use block that was executed
	 * @param toolResult The result from the tool execution
	 * @param executionSuccess Whether the tool executed successfully
	 * @param executionStartTime The timestamp when tool execution started
	 * @returns true if hook requested cancellation, false otherwise
	 */
	private async runPostToolUseHook(
		block: ToolUse,
		toolResult: any,
		executionSuccess: boolean,
		executionStartTime: number,
	): Promise<boolean> {
		const { executeHook } = await import("../hooks/hook-executor")

		const executionTimeMs = Date.now() - executionStartTime

		const postToolResult = await executeHook({
			hookName: "PostToolUse",
			hookInput: {
				postToolUse: {
					toolName: block.name,
					parameters: block.params,
					result: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
					success: executionSuccess,
					executionTimeMs,
				},
			},
			isCancellable: true,
			say: this.say,
			setActiveHookExecution: this.setActiveHookExecution,
			clearActiveHookExecution: this.clearActiveHookExecution,
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled: true, // Already checked by caller
			toolName: block.name,
		})

		// Handle cancellation request
		if (postToolResult.cancel === true) {
			const errorMessage = postToolResult.errorMessage || "Hook requested task cancellation"
			await this.say("error", errorMessage)
			return true
		}

		// Add context modification to the conversation if provided
		if (postToolResult.contextModification) {
			this.addHookContextToConversation(postToolResult.contextModification, "PostToolUse")
		}

		return false
	}

	/**
	 * Handle partial block streaming UI updates.
	 *
	 * During streaming API responses, the AI sends partial tool use blocks as they're
	 * generated. This method updates the UI to show the tool being constructed in real-time.
	 *
	 * NOTE: This is ONLY for UI updates. No tool results are pushed to the conversation
	 * during partial block handling. The complete block handler will add the final result.
	 *
	 * @param block The partial tool use block with incomplete parameters
	 * @param config The task configuration containing all necessary context
	 */
	private async handlePartialBlock(block: ToolUse, config: TaskConfig): Promise<void> {
		// Reactive Observation: Scan the stream for architectural smells
		const observation = this.policyObserver.observeStream(this.taskState.assistantMessageContent)
		if (observation.warning) {
			this.say("text", observation.warning).catch(() => {})
		}

		const handler = this.coordinator.getHandler(block.name)

		// Check if handler supports partial blocks with proper typing
		if (handler && "handlePartialBlock" in handler) {
			const uiHelpers = createUIHelpers(config)
			const partialHandler = handler as IPartialBlockHandler
			await partialHandler.handlePartialBlock(block, uiHelpers)
		}
	}

	/**
	 * Handle complete block execution.
	 *
	 * This is the main execution flow for a tool:
	 * 1. Execute the actual tool (tool handlers now run PreToolUse hooks post-approval)
	 * 2. Run PostToolUse hooks (if enabled) - cannot block, only observe
	 * 3. Add hook context modifications to the conversation
	 * 4. Update focus chain tracking
	 *
	 * Note: PreToolUse hooks are now executed by individual tool handlers after approval
	 * and before the actual tool operation. This provides better UX as approval dialogs
	 * appear immediately without hook execution delay.
	 *
	 * PostToolUse hooks are for observation/logging only and cannot block.
	 *
	 * @param block The complete tool use block with all parameters
	 * @param config The task configuration containing all necessary context
	 */
	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		// Check abort flag at the very start to prevent execution after cancellation
		if (this.taskState.abort) {
			return
		}

		const hooksEnabled = getHooksEnabledSafe()

		// Track if we need to cancel after hooks complete
		let shouldCancelAfterHook = false

		let executionSuccess = true
		let toolResult: any = null
		let toolWasExecuted = false
		const executionStartTime = Date.now()

		// Mode Awareness: Synchronize the guard with the current task mode
		this.guard.setMode(this.stateManager.getGlobalSettingsKey("mode") || "act")

		const parentIoFastPath = shouldBypassGuardForParentIoTool(block.name)

		// Direct Layer Injection — skip for I/O authority (joy-zoning not needed on read/list/search)
		if (!shouldSkipLayerInjectionForParentIoTool(block.name) && block.params.path) {
			const { getLayer } = require("@/utils/joy-zoning")
			block.layer = getLayer(path.resolve(this.cwd, block.params.path))
		}

		// Roadmap write guard + mutation tracking
		if (
			(block.name === DietCodeDefaultTool.FILE_NEW ||
				block.name === DietCodeDefaultTool.FILE_EDIT ||
				block.name === DietCodeDefaultTool.APPLY_PATCH ||
				block.name === DietCodeDefaultTool.DIETCODE_KERNEL) &&
			block.params.path
		) {
			try {
				const { preflightRoadmapWrite, targetsRoadmapFile } = require("@/services/roadmap/RoadmapNativeBridge")
				if (targetsRoadmapFile(block.name, block.params)) {
					const preflight = await preflightRoadmapWrite(block.name, block.params, this.cwd)
					if (preflight.block) {
						const blockMessage = preflight.message ?? "Roadmap write blocked."
						await this.say("error_retry" as any, blockMessage)
						this.taskState.consecutiveMistakeCount++
						this.pushToolResult(formatResponse.toolError(blockMessage), block)
						return
					}
				}
			} catch {
				const { getRoadmapConfig } = require("@/services/roadmap/RoadmapConfig")
				const cfg = getRoadmapConfig()
				if (cfg.enabled && cfg.fail_closed_completion_gates) {
					const message =
						"ROADMAP write guard failed — cannot verify write target safely. Verify workspace root and ROADMAP.md path, then retry the edit."
					await this.say("error_retry" as any, message)
					this.taskState.consecutiveMistakeCount++
					this.pushToolResult(formatResponse.toolError(message), block)
					return
				}
			}
		}

		try {
			if (!parentIoFastPath) {
				// Policy Enforcement: Pre-Execution
				const preExecResult = await this.guard.guardPreExecution(block)
				if (!preExecResult.success) {
					await this.say("error_retry" as any, preExecResult.error!)
					this.taskState.consecutiveMistakeCount++
					this.pushToolResult((formatResponse as any).architecturalCorrection(preExecResult.error!), block)
					return
				}
				if (preExecResult.warning) {
					this.say("text", preExecResult.warning).catch(() => {})
				}
			}

			// Final abort check immediately before tool execution
			if (this.taskState.abort) {
				return
			}

			// Execute the actual tool (parent I/O bulkhead + coalescing when parallel calling enabled)
			const executeTool = async (): Promise<unknown> => this.coordinator.execute(config, block)
			if (parentIoFastPath && config.enableParallelToolCalling) {
				const release = await acquireParentIoSlot(true, Boolean(this.taskState.swarmRuntime))
				try {
					const coalesceKey = buildIoCoalesceKey(block, this.cwd)
					toolResult = coalesceKey
						? await getIoRequestCoalescer(this.taskId).coalesce(coalesceKey, executeTool)
						: await executeTool()
				} finally {
					release()
				}
			} else {
				toolResult = await executeTool()
			}
			toolWasExecuted = true

			// Roadmap post-write: record mutation and attach validate nudge
			if (
				(block.name === DietCodeDefaultTool.FILE_NEW ||
					block.name === DietCodeDefaultTool.FILE_EDIT ||
					block.name === DietCodeDefaultTool.APPLY_PATCH ||
					block.name === DietCodeDefaultTool.DIETCODE_KERNEL) &&
				block.params.path
			) {
				try {
					const { afterRoadmapWrite, appendRoadmapWriteHint, targetsRoadmapFile } =
						require("@/services/roadmap/RoadmapNativeBridge")
					if (targetsRoadmapFile(block.name, block.params)) {
						void afterRoadmapWrite(block.name, block.params, this.cwd).catch((error: unknown) => {
							Logger.warn("[ToolExecutor] Deferred roadmap mutation journal failed:", error)
						})
						toolResult = await appendRoadmapWriteHint(block.name, block.params, this.cwd, toolResult)
					}
				} catch {
					// Non-fatal
				}
			}

			// Autonomous Self-Healing: Align tags and resolve imports
			if (
				(block.name === DietCodeDefaultTool.FILE_NEW || block.name === DietCodeDefaultTool.FILE_EDIT) &&
				block.params.path
			) {
				const fullPath = path.resolve(this.cwd, block.params.path)
				void this.healer.alignTag(fullPath).catch(() => undefined)
			}

			// Policy Enforcement: Read-Time
			if (
				(block.name === DietCodeDefaultTool.FILE_READ || block.name === DietCodeDefaultTool.SEARCH) &&
				block.params.path &&
				typeof toolResult === "string"
			) {
				const pathKey = block.params.path
				const currentCount = this.taskState.currentTurnReadHistory.get(pathKey) || 0
				if (currentCount === 0) {
					this.taskState.currentTurnUniqueReadCount++
				}
				const newCount = currentCount + 1
				this.taskState.currentTurnReadHistory.set(pathKey, newCount)
				this.taskState.currentTurnTotalReadCount++

				const globalCount = (this.taskState.taskReadHistory.get(pathKey) || 0) + 1
				this.taskState.taskReadHistory.set(pathKey, globalCount)

				if (shouldUseIoAuthorityReadFastPath(block.name)) {
					toolResult = this.guard.onReadIoAuthority(block.params.path, toolResult)
				} else {
					toolResult = await this.guard.onRead(
						block.params.path,
						toolResult,
						this.taskState.currentTurnUniqueReadCount,
						newCount,
						globalCount,
					)
				}

				if (block.name === DietCodeDefaultTool.FILE_READ && typeof toolResult === "string") {
					const readPath = block.params.path
					void (async () => {
						try {
							const { NativeMutationManager } = require("@/services/mutation/NativeMutationManager")
							const mutationManager = NativeMutationManager.getInstance()
							if (readPath) {
								await mutationManager.autoTrackFileRead(this.cwd, readPath, config.taskId || config.ulid)
							}
						} catch {
							// Silent fallback
						}
					})()
				}
			}

			this.pushToolResult(toolResult, block)

			if (!parentIoFastPath) {
				const runPostExecution = async () => {
					const postExecResult = await this.guard.guardPostExecution(block, toolResult, undefined)
					if (
						(block.name === DietCodeDefaultTool.FILE_NEW || block.name === DietCodeDefaultTool.FILE_EDIT) &&
						block.params.path
					) {
						const telemetry = this.guard.getStabilityTelemetry(block.params.path)
						const summary = (formatResponse as any).postExecutionSummary(telemetry, postExecResult.violations)
						this.say("text", summary).catch(() => undefined)
					} else if (postExecResult.warning) {
						this.say("text", postExecResult.warning).catch(() => undefined)
					}
				}

				if (shouldDeferParentGuardPostExecution(block.name, config.isSubagentExecution)) {
					void runPostExecution().catch((error) => {
						Logger.warn("[ToolExecutor] Deferred guard post-execution failed:", error)
					})
				} else {
					await runPostExecution()
				}
			}
		} catch (error) {
			executionSuccess = false
			const errorMsg = `Tool execution failed: ${error}`
			toolResult = formatResponse.toolError(errorMsg)

			// Check abort before running PostToolUse hook (error path)
			if (this.taskState.abort) {
				throw error
			}

			// Run PostToolUse hook for failed tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (toolWasExecuted && hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(block, toolResult, executionSuccess, executionStartTime)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}

			// Re-throw the error after PostToolUse completes
			throw error
		}

		// Early return if hook requested cancellation
		if (shouldCancelAfterHook) {
			return
		}

		// Handle focus chain updates (shift-right — non-blocking for tool throughput)
		if (
			!block.partial &&
			block.params.task_progress &&
			this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled
		) {
			void this.updateFCListFromToolResponse(block.params.task_progress).catch(() => undefined)
		}
	}
}
