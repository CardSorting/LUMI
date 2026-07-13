import type { ToolUse } from "@core/assistant-message"
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
import { hasWorkspaceLocalIoAuthority } from "../executionAuthority"
import { executeTaskIoBackend, type TaskIoBackendCallbacks } from "../io/TaskIoBackend"
import type { PathAuthorityRecord } from "../io/TaskPathAuthorityCache"
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
		authority?: PathAuthorityRecord,
	): Array<{ absolutePath: string; workspaceName?: string; workspaceRoot?: string }> {
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const adapter = new WorkspacePathAdapter({
				cwd: config.cwd,
				isMultiRootEnabled: true,
				workspaceManager: config.workspaceManager,
			})

			if (workspaceHint) {
				// Search only in the specified workspace
				const absolutePath = authority?.absolutePath ?? adapter.resolvePath(parsedPath, workspaceHint)
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
		if (authority) {
			return [
				{
					absolutePath: authority.absolutePath,
					workspaceName: authority.selectedWorkspaceRoot.name,
					workspaceRoot: authority.selectedWorkspaceRoot.path,
				},
			]
		}
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
		signal: AbortSignal | undefined,
		io: TaskIoBackendCallbacks,
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
				{
					signal,
					onFirstResult: io.firstUsefulResult,
					onStats: (stats) => {
						io.incrementCounter("repositorySearchSpawns", stats.spawnCount)
						io.incrementCounter("bytesRead", stats.stdoutBytes + stats.stderrBytes)
						io.incrementCounter("bytesCopied", stats.bytesCopied)
						io.incrementCounter("ignorePolicyEvaluations", stats.matchEvents)
					},
				},
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
			if (signal?.aborted) throw signal.reason ?? error
			Logger.error(`Search failed in ${absolutePath}:`, error)
			// A backend failure is not an authoritative empty result. Propagate it so
			// TaskIoBackend cannot cache a false-negative or partial multi-root value.
			throw error
		}
	}

	private async executeSearchesBounded(
		config: TaskConfig,
		searchPaths: Array<{ absolutePath: string; workspaceName?: string; workspaceRoot?: string }>,
		regex: string,
		filePattern: string | undefined,
		signal: AbortSignal | undefined,
		io: TaskIoBackendCallbacks,
	) {
		const results = new Array<Awaited<ReturnType<SearchFilesToolHandler["executeSearch"]>>>(searchPaths.length)
		const ownedController = new AbortController()
		const forwardTaskAbort = () => ownedController.abort(signal?.reason)
		if (signal?.aborted) forwardTaskAbort()
		else signal?.addEventListener("abort", forwardTaskAbort, { once: true })
		let cursor = 0
		const workers = Array.from({ length: Math.min(2, searchPaths.length) }, async () => {
			try {
				while (cursor < searchPaths.length) {
					ownedController.signal.throwIfAborted()
					const index = cursor++
					const target = searchPaths[index]
					results[index] = await this.executeSearch(
						config,
						target.absolutePath,
						target.workspaceName,
						target.workspaceRoot,
						regex,
						filePattern,
						ownedController.signal,
						io,
					)
				}
			} catch (error) {
				if (!ownedController.signal.aborted) ownedController.abort(error)
				throw error
			}
		})
		// Always join both bounded workers. Promise.all would reject on the first
		// failed workspace while another owned ripgrep process was still closing.
		const settled = await Promise.allSettled(workers)
		signal?.removeEventListener("abort", forwardTaskAbort)
		if (signal?.aborted) throw signal.reason ?? new Error("Search cancelled")
		const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")
		if (failed) throw failed.reason
		return results
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

		const operationIsLocatedInWorkspace = await isLocatedInWorkspace(relPath)
		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			regex: uiHelpers.removeClosingTag(block, "regex", regex),
			filePattern: uiHelpers.removeClosingTag(block, "file_pattern", filePattern),
			operationIsLocatedInWorkspace,
		} satisfies DietCodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (
			hasWorkspaceLocalIoAuthority(config.isSubagentExecution, operationIsLocatedInWorkspace) ||
			(await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath))
		) {
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
				await config.callbacks.say("dietcodeignore_error", relDirPath)
			}

			if (validation.error.includes("Missing required parameter")) {
				config.taskState.consecutiveMistakeCount++
				const missingParam = validation.error.includes("'path'") ? "path" : "regex"
				return await config.callbacks.sayAndCreateMissingParamError(this.name, missingParam as any)
			}

			return formatResponse.toolError(validation.error)
		}
		if (!relDirPath || !regex) return formatResponse.toolError("Missing required search parameters.")

		config.taskState.consecutiveMistakeCount = 0

		// Parse workspace hint from the path
		const { workspaceHint, relPath: parsedPath } = parseWorkspaceInlinePath(relDirPath)
		const authority = config.peekIoAuthority?.(block) ?? (await config.resolveIoAuthority?.(block))
		if (authority && !authority.ignoreAllowed) return formatResponse.toolError(`Access to '${relDirPath}' is RESTRICTED.`)

		// Determine which paths to search
		const searchPaths = this.determineSearchPaths(config, parsedPath, workspaceHint, relDirPath, authority)

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

		// Approval before search I/O and reusable lookup. External-path results are
		// never cacheable, and approval remains per invocation.
		const operationIsLocatedInWorkspace = authority?.contained ?? (await isLocatedInWorkspace(parsedPath))
		const pendingMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, relDirPath),
			content: "",
			regex: regex,
			filePattern: filePattern,
			operationIsLocatedInWorkspace,
		} satisfies DietCodeSayTool

		const pendingMessage = JSON.stringify(pendingMessageProps)

		let pendingPresentation: Promise<void> = Promise.resolve()
		const shouldAutoApprove =
			hasWorkspaceLocalIoAuthority(config.isSubagentExecution, operationIsLocatedInWorkspace) ||
			(await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath))
		if (shouldAutoApprove) {
			if (!config.isSubagentExecution) {
				pendingPresentation = (async () => {
					await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
					await config.callbacks.say("tool", pendingMessage, undefined, undefined, false)
				})().catch(() => undefined)
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
			if (config.isSubagentExecution) {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			}
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		const searchStartTime = performance.now()
		let searchResults: Awaited<ReturnType<SearchFilesToolHandler["executeSearchesBounded"]>> = []
		const results = await executeTaskIoBackend(config, block, authority, "search", async (io, signal) => {
			searchResults = await this.executeSearchesBounded(config, searchPaths, regex, filePattern, signal, io)
			return this.formatSearchResults(config, searchResults, searchPaths)
		})
		const searchDurationMs = performance.now() - searchStartTime

		// Capture workspace search pattern telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const searchType = workspaceHint ? "targeted" : searchPaths.length > 1 ? "cross_workspace" : "primary_only"
			// A warm backend-cache hit intentionally bypasses executeSearchesBounded, so
			// derive this advisory bit from the canonical payload rather than transient
			// per-process state.
			const resultsFound = !results.startsWith("Found 0 result")

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
			path: getReadablePath(config.cwd, relDirPath),
			content: results,
			regex: regex,
			filePattern: filePattern,
			operationIsLocatedInWorkspace,
		} satisfies DietCodeSayTool

		if (shouldAutoApprove && !config.isSubagentExecution) {
			void pendingPresentation
				.then(() => config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, false))
				.catch(() => undefined)
		} else {
			void pendingPresentation
		}

		return results
	}
}
