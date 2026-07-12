import type { ToolUse } from "@core/assistant-message"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { parseSourceCodeForDefinitionsTopLevel } from "@services/tree-sitter"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { formatResponse } from "@/core/prompts/responses"
import { telemetryService } from "@/services/telemetry"
import { DietCodeDefaultTool } from "@/shared/tools"
import { showNotificationForApproval } from "../../utils"
import { hasWorkspaceLocalIoAuthority } from "../executionAuthority"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { IFullyManagedTool, ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ListCodeDefinitionNamesToolHandler implements IFullyManagedTool {
	readonly name = DietCodeDefaultTool.LIST_CODE_DEF

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) {
			return
		}

		// Create and show partial UI message
		const operationIsLocatedInWorkspace = await isLocatedInWorkspace(relPath)
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
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

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters and check dietcodeignore access
		const validation = await this.validator.validate(block, "path")
		if (!validation.ok) {
			if (validation.error.includes("Missing required parameter")) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
			}

			return formatResponse.toolError(validation.error)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relDirPath!, "ListCodeDefinitionNamesToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relDirPath! } : pathResult

		// Approval before I/O — mirrors read_file
		const operationIsLocatedInWorkspace = await isLocatedInWorkspace(relDirPath!)
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, displayPath),
			content: "",
			operationIsLocatedInWorkspace,
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		const shouldAutoApprove =
			hasWorkspaceLocalIoAuthority(config.isSubagentExecution, operationIsLocatedInWorkspace) ||
			(await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath))
		if (shouldAutoApprove) {
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			}

			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				undefined,
				block.isNativeToolCall,
			)
		} else {
			const notificationMessage = `DietCode wants to analyze code definitions in ${getWorkspaceBasename(absolutePath, "ListCodeDefinitionNamesToolHandler.notification")}`

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
					undefined,
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
				undefined,
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

		const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.dietcodeIgnoreController)

		if (shouldAutoApprove && !config.isSubagentExecution) {
			const resultMessage = JSON.stringify({ ...sharedMessageProps, content: result })
			await config.callbacks.say("tool", resultMessage, undefined, undefined, false)
		}

		return result
	}
}
