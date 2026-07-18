import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { listFiles } from "@services/glob/list-files"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { DietCodeDefaultTool } from "@/shared/tools"
import { showNotificationForApproval } from "../../utils"
import { hasWorkspaceLocalIoAuthority } from "../execution/ExecutionFunnel"
import { executeTaskIoBackend } from "../io/TaskIoBackend"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { IFullyManagedTool, ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ListFilesToolHandler implements IFullyManagedTool {
	readonly name = DietCodeDefaultTool.LIST_FILES

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		// Get config access for services
		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) {
			return
		}

		// Create and show partial UI message
		const recursiveRaw = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"
		const operationIsLocatedInWorkspace = await isLocatedInWorkspace(relPath)
		const sharedMessageProps = {
			tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			operationIsLocatedInWorkspace,
		}

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
		const recursiveRaw: string | undefined = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters and check dietcodeignore access
		const validation = await this.validator.validate(block, "path")
		if (!validation.ok) {
			if (!config.isSubagentExecution && validation.error.includes("RESTRICTED")) {
				await config.callbacks.say("dietcodeignore_error", relDirPath)
			}

			if (validation.error.includes("Missing required parameter")) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
			}

			return formatResponse.toolError(validation.error)
		}
		if (!relDirPath) return formatResponse.toolError("Missing required parameter 'path'.")

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const authority = config.peekIoAuthority?.(block) ?? (await config.resolveIoAuthority?.(block))
		if (authority && !authority.ignoreAllowed) return formatResponse.toolError(`Access to '${relDirPath}' is RESTRICTED.`)
		const pathResult = authority ?? resolveWorkspacePath(config, relDirPath, "ListFilesToolHandler.execute")
		const { absolutePath, displayPath } = authority
			? { absolutePath: authority.absolutePath, displayPath: authority.displayPath }
			: typeof pathResult === "string"
				? { absolutePath: pathResult, displayPath: relDirPath }
				: pathResult

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relDirPath ?? "")
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: authority ? Boolean(authority.workspaceHint) : typeof pathResult !== "string",
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (authority?.workspaceHint || typeof pathResult !== "string" ? "hint" : "primary_fallback") as
				| "hint"
				| "primary_fallback",
		}

		// Handle approval before I/O — mirrors read_file (avoid wasted work on manual deny)
		const operationIsLocatedInWorkspace = authority?.contained ?? (await isLocatedInWorkspace(relDirPath))
		const sharedMessageProps = {
			tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
			path: getReadablePath(config.cwd, displayPath),
			content: "",
			operationIsLocatedInWorkspace,
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		let pendingPresentation: Promise<void> = Promise.resolve()
		const shouldAutoApprove =
			hasWorkspaceLocalIoAuthority(config.isSubagentExecution, operationIsLocatedInWorkspace) ||
			(await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath))
		if (shouldAutoApprove) {
			if (!config.isSubagentExecution) {
				pendingPresentation = (async () => {
					await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
					await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
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
			const notificationMessage = `DietCode wants to view directory ${getWorkspaceBasename(absolutePath, "ListFilesToolHandler.notification")}/`

			showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
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

		const result = await executeTaskIoBackend(config, block, authority, "traversal", async (io, signal) => {
			const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200, {
				signal,
				onFirstResult: io.firstUsefulResult,
				onStats: (stats) => {
					io.incrementCounter("directoryReadCalls", stats.directoryReadOperations)
				},
			})
			io.incrementCounter("ignorePolicyEvaluations", files.length)
			return formatResponse.formatFilesList(absolutePath, files, didHitLimit, config.services.dietcodeIgnoreController)
		})

		if (shouldAutoApprove && !config.isSubagentExecution) {
			const resultMessage = JSON.stringify({ ...sharedMessageProps, content: result })
			void pendingPresentation
				.then(() => config.callbacks.say("tool", resultMessage, undefined, undefined, false))
				.catch(() => undefined)
		} else {
			void pendingPresentation
		}

		return result
	}
}
