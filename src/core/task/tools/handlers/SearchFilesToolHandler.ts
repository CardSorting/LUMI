import type { ToolUse } from "@core/assistant-message"
import {
	createJoyRideTaskScope,
	getJoyRideCache,
	isJoyRideHitDecision,
	lookupSearchResult,
	storeSearchResult,
} from "@core/joyride"
import { regexSearchFiles } from "@services/ripgrep"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import * as path from "path"
import { formatResponse } from "@/core/prompts/responses"
import { parseWorkspaceInlinePath } from "@/core/workspace/utils/parseWorkspaceInlinePath"
import { WorkspacePathAdapter } from "@/core/workspace/WorkspacePathAdapter"
import { resolveWorkspacePath } from "@/core/workspace/WorkspaceResolver"
import { telemetryService } from "@/services/telemetry"
import { DietCodeSayTool } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { DietCodeDefaultTool } from "@/shared/tools"
import { showNotificationForApproval } from "../../utils"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { IFullyManagedTool, ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class SearchFilesToolHandler implements IFullyManagedTool {
	readonly name = DietCodeDefaultTool.SEARCH

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.regex}'${
			block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
		}]`
	}

	/**
	 * Determines which paths to search based on workspace configuration and hints
	 */
	private determineSearchPaths(
		config: TaskConfig,
		parsedPath: string,
		workspaceHint: string | undefined,
		originalPath: string,
	): Array<{ absolutePath: string; workspaceName?: string; workspaceRoot?: string }> {
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const adapter = new WorkspacePathAdapter({
				cwd: config.cwd,
				isMultiRootEnabled: true,
				workspaceManager: config.workspaceManager,
			})

			if (workspaceHint) {
				// Search only in the specified workspace
				const absolutePath = adapter.resolvePath(parsedPath, workspaceHint)
				const workspaceRoots = adapter.getWorkspaceRoots()
				const root = workspaceRoots.find((r) => r.name === workspaceHint)
				return [{ absolutePath, workspaceName: workspaceHint, workspaceRoot: root?.path }]
			}
			// As a fallback, perform the search across all available workspaces.
			// Typically, models should provide explicit hints to target specific workspaces for searching.
			const allPaths = adapter.getAllPossiblePaths(parsedPath)
			const workspaceRoots = adapter.getWorkspaceRoots()
			return allPaths.map((absPath, index) => ({
				absolutePath: absPath,
				workspaceName: workspaceRoots[index]?.name || path.basename(workspaceRoots[index]?.path || absPath),
				workspaceRoot: workspaceRoots[index]?.path,
			}))
		}
		// Single-workspace mode (backward compatible)
		const pathResult = resolveWorkspacePath(config, originalPath, "SearchFilesTool.execute")
		const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
		return [{ absolutePath, workspaceRoot: config.cwd }]
	}

	/**
	 * Executes a single search operation in a workspace
	 */
	private async executeSearch(
		config: TaskConfig,
		absolutePath: string,
		workspaceName: string | undefined,
		workspaceRoot: string | undefined,
		regex: string,
		filePattern: string | undefined,
	) {
		try {
			// Use workspace root for relative path calculation, fallback to cwd
			const basePathForRelative = workspaceRoot || config.cwd

			const workspaceResults = await regexSearchFiles(
				basePathForRelative,
				absolutePath,
				regex,
				filePattern,
				config.services.dietcodeIgnoreController,
			)

			// Parse the result count from the first line
			const firstLine = workspaceResults.split("\n")[0]
			const resultMatch = firstLine.match(/Found (\d+) result/)
			const resultCount = resultMatch ? Number.parseInt(resultMatch[1], 10) : 0

			return {
				workspaceName,
				workspaceResults,
				resultCount,
				success: true,
			}
		} catch (error) {
			// If search fails in one workspace, return error info
			Logger.error(`Search failed in ${absolutePath}:`, error)
			return {
				workspaceName,
				workspaceResults: "",
				resultCount: 0,
				success: false,
			}
		}
	}

	/**
	 * Formats search results based on workspace configuration
	 */
	private formatSearchResults(
		config: TaskConfig,
		searchResults: Array<{
			workspaceName?: string
			workspaceResults: string
			resultCount: number
			success: boolean
		}>,
		searchPaths: Array<{ absolutePath: string; workspaceName?: string }>,
	): string {
		const allResults: string[] = []
		let totalResultCount = 0

		for (const { workspaceName, workspaceResults, resultCount, success } of searchResults) {
			if (!success || !workspaceResults) {
				continue
			}

			totalResultCount += resultCount

			// If multi-workspace and we have results, annotate with workspace name
			if (config.isMultiRootEnabled && searchPaths.length > 1 && workspaceName) {
				// Check if this workspace has results (resultCount > 0)
				if (resultCount > 0) {
					// Skip the "Found X results" line and add workspace annotation
					const lines = workspaceResults.split("\n")
					// Skip first two lines (count and empty line) if they exist
					const resultsWithoutHeader = lines.length > 2 ? lines.slice(2).join("\n") : workspaceResults

					if (resultsWithoutHeader.trim()) {
						allResults.push(`## Workspace: ${workspaceName}\n${resultsWithoutHeader}`)
					}
				}
				// Don't add anything for workspaces with 0 results in multi-workspace mode
			} else if (!config.isMultiRootEnabled || searchPaths.length === 1) {
				// Single workspace mode or single workspace search
				allResults.push(workspaceResults)
			}
		}

		// Combine results
		if (config.isMultiRootEnabled && searchPaths.length > 1) {
			// Multi-workspace search result
			if (totalResultCount === 0) {
				return "Found 0 results."
			}
			return `Found ${totalResultCount === 1 ? "1 result" : `${totalResultCount.toLocaleString()} results`} across ${searchPaths.length} workspace${searchPaths.length > 1 ? "s" : ""}.\n\n${allResults.join("\n\n")}`
		}
		// Single workspace result
		return allResults[0] || "Found 0 results."
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path
		const regex = block.params.regex

		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) {
			return
		}

		// Create and show partial UI message
		const filePattern = block.params.file_pattern

		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			regex: uiHelpers.removeClosingTag(block, "regex", regex),
			filePattern: uiHelpers.removeClosingTag(block, "file_pattern", filePattern),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		} satisfies DietCodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relDirPath: string | undefined = block.params.path
		const regex: string | undefined = block.params.regex
		const filePattern: string | undefined = block.params.file_pattern

		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters and check dietcodeignore access
		const validation = await this.validator.validate(block, "path", "regex")
		if (!validation.ok) {
			if (!config.isSubagentExecution && validation.error.includes("RESTRICTED")) {
				await config.callbacks.say("dietcodeignore_error", relDirPath!)
			}

			if (validation.error.includes("Missing required parameter")) {
				config.taskState.consecutiveMistakeCount++
				const missingParam = validation.error.includes("'path'") ? "path" : "regex"
				return await config.callbacks.sayAndCreateMissingParamError(this.name, missingParam as any)
			}

			return formatResponse.toolError(validation.error)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse workspace hint from the path
		const { workspaceHint, relPath: parsedPath } = parseWorkspaceInlinePath(relDirPath!)

		// Determine which paths to search
		const searchPaths = this.determineSearchPaths(config, parsedPath, workspaceHint, relDirPath!)

		const joyRideScope = createJoyRideTaskScope(
			config.taskId,
			config.cwd,
			config.vscodeTerminalExecutionMode,
			config.taskState.apiRequestCount,
		)
		const grepCacheKey = `${regex}:${filePattern ?? ""}:${searchPaths.map((p) => p.absolutePath).join("|")}`
		const grepOptions = {
			cwd: config.cwd,
			includeGlobs: filePattern ? [filePattern] : undefined,
			excludeGlobs: undefined as string[] | undefined,
			caseSensitive: true,
		}
		const searchDecision = await lookupSearchResult(getJoyRideCache(), grepCacheKey, grepOptions, joyRideScope)
		if (isJoyRideHitDecision(searchDecision)) {
			return searchDecision.value
		}

		// Determine workspace context for telemetry
		const primaryWorkspaceRoot = searchPaths[0]?.workspaceRoot
		const resolvedToNonPrimary =
			searchPaths.length === 0
				? true
				: searchPaths.length > 1 || (primaryWorkspaceRoot ? !arePathsEqual(primaryWorkspaceRoot, config.cwd) : true)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: !!workspaceHint,
			resolvedToNonPrimary,
			resolutionMethod: (workspaceHint ? "hint" : searchPaths.length > 1 ? "path_detection" : "primary_fallback") as
				| "hint"
				| "primary_fallback"
				| "path_detection",
		}

		// Capture workspace path resolution telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const resolutionType = workspaceHint
				? "hint_provided"
				: searchPaths.length > 1
					? "cross_workspace_search"
					: "fallback_to_primary"

			const primarySearchPath = searchPaths[0]?.absolutePath
			const primaryWorkspaceIndex = primarySearchPath
				? config.workspaceManager
						.getRoots()
						.findIndex((r) => arePathsEqual(r.path, primarySearchPath) || primarySearchPath.startsWith(r.path))
				: undefined

			telemetryService.captureWorkspacePathResolved(
				config.ulid,
				"SearchFilesToolHandler",
				resolutionType,
				workspaceHint ? "workspace_name" : undefined,
				searchPaths.length > 0, // resolution success = found paths to search
				primaryWorkspaceIndex !== undefined && primaryWorkspaceIndex >= 0 ? primaryWorkspaceIndex : undefined,
				true,
			)
		}

		// Approval before search I/O — cache-aside hits skip this path entirely
		const pendingMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, relDirPath!),
			content: "",
			regex: regex,
			filePattern: filePattern,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
		} satisfies DietCodeSayTool

		const pendingMessage = JSON.stringify(pendingMessageProps)

		const shouldAutoApprove =
			config.isSubagentExecution || (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath))
		if (shouldAutoApprove) {
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", pendingMessage, undefined, undefined, false)
			}

			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			const notificationMessage = `DietCode wants to search files for ${regex}`

			showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", pendingMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		}

		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// Execute searches in all relevant workspaces in parallel
		const searchPromises = searchPaths.map(({ absolutePath, workspaceName, workspaceRoot }) =>
			this.executeSearch(config, absolutePath, workspaceName, workspaceRoot, regex as string, filePattern),
		)

		// Wait for all searches to complete
		const searchStartTime = performance.now()
		const searchResults = await Promise.all(searchPromises)
		const searchDurationMs = performance.now() - searchStartTime

		// Format and combine results
		const results = this.formatSearchResults(config, searchResults, searchPaths)

		const totalResultCount = searchResults.reduce((sum, r) => sum + (r.success ? r.resultCount : 0), 0)
		void storeSearchResult(getJoyRideCache(), grepCacheKey, grepOptions, results, totalResultCount, joyRideScope)

		// Capture workspace search pattern telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const searchType = workspaceHint ? "targeted" : searchPaths.length > 1 ? "cross_workspace" : "primary_only"
			const resultsFound = searchResults.some((result) => result.resultCount > 0)

			telemetryService.captureWorkspaceSearchPattern(
				config.ulid,
				searchType,
				searchPaths.length,
				!!workspaceHint,
				resultsFound,
				searchDurationMs,
			)
		}

		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, relDirPath!),
			content: results,
			regex: regex,
			filePattern: filePattern,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
		} satisfies DietCodeSayTool

		if (shouldAutoApprove && !config.isSubagentExecution) {
			await config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, false)
		}

		return results
	}
}
