import type { ToolUse } from "@core/assistant-message"
import { CLINE_MCP_TOOL_IDENTIFIER } from "@/shared/mcp"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../index"
import { AccessMcpResourceHandler } from "./handlers/AccessMcpResourceHandler"
import { ActModeRespondHandler } from "./handlers/ActModeRespondHandler"
import { ApplyPatchHandler } from "./handlers/ApplyPatchHandler"
import { AskFollowupQuestionToolHandler } from "./handlers/AskFollowupQuestionToolHandler"
import { AttemptCompletionHandler } from "./handlers/AttemptCompletionHandler"
import { BrowserToolHandler } from "./handlers/BrowserToolHandler"
import { CognitiveMemoryAppendSharedHandler } from "./handlers/CognitiveMemoryAppendSharedHandler"
import { CognitiveMemoryBlameHandler } from "./handlers/CognitiveMemoryBlameHandler"
import { CognitiveMemoryBlastHandler } from "./handlers/CognitiveMemoryBlastHandler"
import { CognitiveMemoryBundleHandler } from "./handlers/CognitiveMemoryBundleHandler"
import { CognitiveMemoryCentralityHandler } from "./handlers/CognitiveMemoryCentralityHandler"
import { CognitiveMemoryChangelogHandler } from "./handlers/CognitiveMemoryChangelogHandler"
import { CognitiveMemoryChokeHandler } from "./handlers/CognitiveMemoryChokeHandler"
import { CognitiveMemoryClaimHandler } from "./handlers/CognitiveMemoryClaimHandler"
import { CognitiveMemoryContextHandler } from "./handlers/CognitiveMemoryContextHandler"
import { CognitiveMemoryForecastHandler } from "./handlers/CognitiveMemoryForecastHandler"
import { CognitiveMemoryGetSharedHandler } from "./handlers/CognitiveMemoryGetSharedHandler"
import { CognitiveMemoryHealHandler } from "./handlers/CognitiveMemoryHealHandler"
import { CognitiveMemoryHubsHandler } from "./handlers/CognitiveMemoryHubsHandler"
import { CognitiveMemoryLinkHandler } from "./handlers/CognitiveMemoryLinkHandler"
import { CognitiveMemoryMergeHandler } from "./handlers/CognitiveMemoryMergeHandler"
import { CognitiveMemoryQueryHandler } from "./handlers/CognitiveMemoryQueryHandler"
import { CognitiveMemoryRefreshHandler } from "./handlers/CognitiveMemoryRefreshHandler"
import { CognitiveMemoryReleaseHandler } from "./handlers/CognitiveMemoryReleaseHandler"
import { CognitiveMemorySnapshotHandler } from "./handlers/CognitiveMemorySnapshotHandler"
import { CognitiveMemorySubgraphHandler } from "./handlers/CognitiveMemorySubgraphHandler"
import { CondenseHandler } from "./handlers/CondenseHandler"
import { ExecuteCommandToolHandler } from "./handlers/ExecuteCommandToolHandler"
import { GenerateExplanationToolHandler } from "./handlers/GenerateExplanationToolHandler"
import { ListCodeDefinitionNamesToolHandler } from "./handlers/ListCodeDefinitionNamesToolHandler"
import { ListFilesToolHandler } from "./handlers/ListFilesToolHandler"
import { LoadMcpDocumentationHandler } from "./handlers/LoadMcpDocumentationHandler"
import { NewTaskHandler } from "./handlers/NewTaskHandler"
import { PlanModeRespondHandler } from "./handlers/PlanModeRespondHandler"
import { ReadFileToolHandler } from "./handlers/ReadFileToolHandler"
import { ReportBugHandler } from "./handlers/ReportBugHandler"
import { SearchFilesToolHandler } from "./handlers/SearchFilesToolHandler"
import { UseSubagentsToolHandler } from "./handlers/SubagentToolHandler"
import { SummarizeTaskHandler } from "./handlers/SummarizeTaskHandler"
import { UseMcpToolHandler } from "./handlers/UseMcpToolHandler"
import { UseSkillToolHandler } from "./handlers/UseSkillToolHandler"
import { WebFetchToolHandler } from "./handlers/WebFetchToolHandler"
import { WebSearchToolHandler } from "./handlers/WebSearchToolHandler"
import { WriteToFileToolHandler } from "./handlers/WriteToFileToolHandler"
import { AgentConfigLoader } from "./subagent/AgentConfigLoader"
import { ToolValidator } from "./ToolValidator"
import type { TaskConfig } from "./types/TaskConfig"
import type { StronglyTypedUIHelpers } from "./types/UIHelpers"

export interface IToolHandler {
	readonly name: CodemarieDefaultTool
	execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
	getDescription(block: ToolUse): string
}

export interface IPartialBlockHandler {
	handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void>
}

export interface IFullyManagedTool extends IToolHandler, IPartialBlockHandler {
	// Marker interface for tools that handle their own complete approval flow
}

/**
 * A wrapper class that allows a single tool handler to be registered under multiple names.
 * This provides proper typing for tools that share the same implementation logic.
 */
export class SharedToolHandler implements IFullyManagedTool {
	constructor(
		public readonly name: CodemarieDefaultTool,
		private baseHandler: IFullyManagedTool,
	) {}

	getDescription(block: ToolUse): string {
		return this.baseHandler.getDescription(block)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		return this.baseHandler.execute(config, block)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return this.baseHandler.handlePartialBlock(block, uiHelpers)
	}
}

/**
 * Coordinates tool execution by routing to registered handlers.
 * Falls back to legacy switch for unregistered tools.
 */
export class ToolExecutorCoordinator {
	private handlers = new Map<string, IToolHandler>()
	private dynamicSubagentHandlers = new Map<string, IToolHandler>()

	private readonly toolHandlersMap: Record<CodemarieDefaultTool, (v: ToolValidator) => IToolHandler | undefined> = {
		[CodemarieDefaultTool.ASK]: (_v: ToolValidator) => new AskFollowupQuestionToolHandler(),
		[CodemarieDefaultTool.ATTEMPT]: (_v: ToolValidator) => new AttemptCompletionHandler(),
		[CodemarieDefaultTool.BASH]: (v: ToolValidator) => new ExecuteCommandToolHandler(v),
		[CodemarieDefaultTool.FILE_EDIT]: (v: ToolValidator) =>
			new SharedToolHandler(CodemarieDefaultTool.FILE_EDIT, new WriteToFileToolHandler(v)),
		[CodemarieDefaultTool.FILE_READ]: (v: ToolValidator) => new ReadFileToolHandler(v),
		[CodemarieDefaultTool.FILE_NEW]: (v: ToolValidator) => new WriteToFileToolHandler(v),
		[CodemarieDefaultTool.SEARCH]: (v: ToolValidator) => new SearchFilesToolHandler(v),
		[CodemarieDefaultTool.LIST_FILES]: (v: ToolValidator) => new ListFilesToolHandler(v),
		[CodemarieDefaultTool.LIST_CODE_DEF]: (v: ToolValidator) => new ListCodeDefinitionNamesToolHandler(v),
		[CodemarieDefaultTool.BROWSER]: (_v: ToolValidator) => new BrowserToolHandler(),
		[CodemarieDefaultTool.MCP_USE]: (_v: ToolValidator) => new UseMcpToolHandler(),
		[CodemarieDefaultTool.MCP_ACCESS]: (_v: ToolValidator) => new AccessMcpResourceHandler(),
		[CodemarieDefaultTool.MCP_DOCS]: (_v: ToolValidator) => new LoadMcpDocumentationHandler(),
		[CodemarieDefaultTool.NEW_TASK]: (_v: ToolValidator) => new NewTaskHandler(),
		[CodemarieDefaultTool.PLAN_MODE]: (_v: ToolValidator) => new PlanModeRespondHandler(),
		[CodemarieDefaultTool.ACT_MODE]: (_v: ToolValidator) => new ActModeRespondHandler(),
		[CodemarieDefaultTool.TODO]: (_v: ToolValidator) => undefined,
		[CodemarieDefaultTool.WEB_FETCH]: (_v: ToolValidator) => new WebFetchToolHandler(),
		[CodemarieDefaultTool.WEB_SEARCH]: (_v: ToolValidator) => new WebSearchToolHandler(),
		[CodemarieDefaultTool.CONDENSE]: (_v: ToolValidator) => new CondenseHandler(),
		[CodemarieDefaultTool.SUMMARIZE_TASK]: (_v: ToolValidator) => new SummarizeTaskHandler(_v),
		[CodemarieDefaultTool.REPORT_BUG]: (_v: ToolValidator) => new ReportBugHandler(),
		[CodemarieDefaultTool.NEW_RULE]: (v: ToolValidator) =>
			new SharedToolHandler(CodemarieDefaultTool.NEW_RULE, new WriteToFileToolHandler(v)),
		[CodemarieDefaultTool.APPLY_PATCH]: (_v: ToolValidator) => new ApplyPatchHandler(_v),
		[CodemarieDefaultTool.GENERATE_EXPLANATION]: (_v: ToolValidator) => new GenerateExplanationToolHandler(),
		[CodemarieDefaultTool.USE_SKILL]: (_v: ToolValidator) => new UseSkillToolHandler(),
		[CodemarieDefaultTool.USE_SUBAGENTS]: (_v: ToolValidator) => new UseSubagentsToolHandler(),
		[CodemarieDefaultTool.MEM_QUERY]: (_v: ToolValidator) => new CognitiveMemoryQueryHandler(),
		[CodemarieDefaultTool.MEM_SNAPSHOT]: (_v: ToolValidator) => new CognitiveMemorySnapshotHandler(),
		[CodemarieDefaultTool.MEM_LINK]: (_v: ToolValidator) => new CognitiveMemoryLinkHandler(),
		[CodemarieDefaultTool.MEM_MERGE]: (_v: ToolValidator) => new CognitiveMemoryMergeHandler(),
		[CodemarieDefaultTool.MEM_REFRESH]: (_v: ToolValidator) => new CognitiveMemoryRefreshHandler(),
		[CodemarieDefaultTool.MEM_CONTEXT]: (_v: ToolValidator) => new CognitiveMemoryContextHandler(),
		[CodemarieDefaultTool.MEM_BLAST]: (_v: ToolValidator) => new CognitiveMemoryBlastHandler(),
		[CodemarieDefaultTool.MEM_CHOKE]: (_v: ToolValidator) => new CognitiveMemoryChokeHandler(),
		[CodemarieDefaultTool.MEM_HEAL]: (_v: ToolValidator) => new CognitiveMemoryHealHandler(),
		[CodemarieDefaultTool.MEM_FORECAST]: (_v: ToolValidator) => new CognitiveMemoryForecastHandler(),
		[CodemarieDefaultTool.MEM_CENTRALITY]: (_v: ToolValidator) => new CognitiveMemoryCentralityHandler(),
		[CodemarieDefaultTool.MEM_SUBGRAPH]: (_v: ToolValidator) => new CognitiveMemorySubgraphHandler(),
		[CodemarieDefaultTool.MEM_APPEND_SHARED]: (_v: ToolValidator) => new CognitiveMemoryAppendSharedHandler(),
		[CodemarieDefaultTool.MEM_GET_SHARED]: (_v: ToolValidator) => new CognitiveMemoryGetSharedHandler(),
		[CodemarieDefaultTool.MEM_BUNDLE]: (_v: ToolValidator) => new CognitiveMemoryBundleHandler(),
		[CodemarieDefaultTool.MEM_BLAME]: (_v: ToolValidator) => new CognitiveMemoryBlameHandler(),
		[CodemarieDefaultTool.MEM_CHANGELOG]: (_v: ToolValidator) => new CognitiveMemoryChangelogHandler(),
		[CodemarieDefaultTool.MEM_CLAIM]: (_v: ToolValidator) => new CognitiveMemoryClaimHandler(),
		[CodemarieDefaultTool.MEM_RELEASE]: (_v: ToolValidator) => new CognitiveMemoryReleaseHandler(),
		[CodemarieDefaultTool.MEM_HUBS]: (_v: ToolValidator) => new CognitiveMemoryHubsHandler(),
	}

	/**
	 * Register a tool handler
	 */
	register(handler: IToolHandler): void {
		this.handlers.set(handler.name, handler)
	}

	registerByName(toolName: CodemarieDefaultTool, validator: ToolValidator): void {
		const handler = this.toolHandlersMap[toolName]?.(validator)
		if (handler) {
			this.register(handler)
		}
	}

	/**
	 * Check if a handler is registered for the given tool
	 */
	has(toolName: string): boolean {
		return this.getHandler(toolName) !== undefined
	}

	/**
	 * Get a handler for the given tool name
	 */
	getHandler(toolName: string): IToolHandler | undefined {
		// HACK: Normalize MCP tool names to the standard handler
		if (toolName.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
			toolName = CodemarieDefaultTool.MCP_USE
		}

		const staticHandler = this.handlers.get(toolName)
		if (staticHandler) {
			return staticHandler
		}

		if (AgentConfigLoader.getInstance().isDynamicSubagentTool(toolName)) {
			const existingHandler = this.dynamicSubagentHandlers.get(toolName)
			if (existingHandler) {
				return existingHandler
			}
			const handler = new SharedToolHandler(toolName as CodemarieDefaultTool, new UseSubagentsToolHandler())
			this.dynamicSubagentHandlers.set(toolName, handler)
			return handler
		}

		return undefined
	}

	/**
	 * Execute a tool through its registered handler
	 */
	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const handler = this.getHandler(block.name)
		if (!handler) {
			throw new Error(`No handler registered for tool: ${block.name}`)
		}

		// Production Hardening: Global parameter normalization
		// Ensures tools that expect 'path' can also handle 'absolutePath' from older models/variants
		this.normalizeToolParameters(block)

		return handler.execute(config, block)
	}

	/**
	 * Normalizes tool parameters to ensure consistency across different model variants.
	 * Currently handles 'path' vs 'absolutePath' unification.
	 */
	private normalizeToolParameters(block: ToolUse): void {
		if (!block.params) {
			return
		}

		// Fallback for path naming inconsistencies
		if (!block.params.path && block.params.absolutePath) {
			block.params.path = block.params.absolutePath
		}
	}
}
