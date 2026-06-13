import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { DietCodeSayTool } from "@/shared/ExtensionMessage"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SafeNumber } from "../../../../shared/utils/SafeNumber"
import { showNotificationForApproval } from "../../utils"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { IFullyManagedTool, ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ReadFileToolHandler implements IFullyManagedTool {
	readonly name = DietCodeDefaultTool.FILE_READ

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
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

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
		const relPath: string | undefined = block.params.path

		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters and check dietcodeignore access
		const validation = await this.validator.validate(block, "path")
		if (!validation.ok) {
			if (!config.isSubagentExecution && validation.error.includes("RESTRICTED")) {
				await config.callbacks.say("dietcodeignore_error", relPath)
			}

			if (validation.error.includes("Missing required parameter")) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
			}

			return formatResponse.toolError(validation.error)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relPath as string, "ReadFileToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath as string } : pathResult

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath ?? "")
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Handle approval flow
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, displayPath),
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		} satisfies DietCodeSayTool

		const completeMessage = JSON.stringify(sharedMessageProps)

		const shouldAutoApprove =
			config.isSubagentExecution || (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath))
		if (shouldAutoApprove) {
			// Auto-approval flow
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			}

			// Capture telemetry
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
			// Manual approval flow
			const notificationMessage = `DietCode wants to read ${getWorkspaceBasename(absolutePath, "ReadFileToolHandler.notification")}`

			// Show notification
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

		// Run PreToolUse hook after approval but before execution
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

		// Execute the actual file read operation
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		let fileContent: import("@integrations/misc/extract-file-content").FileContentResult
		try {
			fileContent = await extractFileContent(absolutePath, supportsImages)
		} catch (error) {
			if (error instanceof Error && error.message.includes("File not found") && absolutePath.endsWith("scratchpad.md")) {
				// V19: Proactive diagnostic injection on auto-creation
				let diagnostics: import("../../../policy/IntegrityProtocol").StabilityDiagnostics | undefined
				try {
					const { FluidPolicyEngine } = await import("../../../policy/FluidPolicyEngine")
					const engine = new FluidPolicyEngine(config.cwd)
					const stats = engine.getStabilityStats()
					const violations = engine.getViolations()
					const entropy = engine.getEntropy()
					diagnostics = {
						buildHealth: Math.round((1 - entropy.score) * 100),
						workloadLevel: `${stats.totalWrites} writes across ${engine.getNodes().size} nodes`,
						buildErrors: violations
							.filter((v) => v.severity === "ERROR")
							.map((v) => `[${v.id}] ${v.path}: ${v.message}`),
						lintWarnings: violations
							.filter((v) => v.severity === "WARN")
							.map((v) => `[${v.id}] ${v.path}: ${v.message}`),
						hotspots: stats.hotspots.map((h) => `${path.basename(h.path)} (${SafeNumber.format(h.stress, 2)})`),
					}
				} catch (_e) {
					// Fallback to empty if diagnostics fail
				}

				const { IntegrityProtocol } = await import("../../../policy/IntegrityProtocol")
				const forensicTrace =
					config.universalGuard?.getForensics().generateInvestigationTrace() ??
					"No prior read observations are available for this task yet."

				const template = IntegrityProtocol.generateAuditTemplate(
					"Initial Architectural Audit",
					diagnostics,
					forensicTrace,
				)

				const fs = await import("fs/promises")
				await fs.writeFile(absolutePath, template, "utf8")
				return (
					"The file `scratchpad.md` did not exist, but I have automatically generated it with the supportive Strategic Review template and current diagnostics. Please use `edit_file` to perform your review.\n\n" +
					template
				)
			}
			throw error
		}

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath as string, "read_tool")

		// Handle image blocks separately - they need to be pushed to userMessageContent
		if (fileContent.imageBlock) {
			config.taskState.userMessageContent.push(fileContent.imageBlock)
		}

		// --- JoyZoning Sovereign Context Injection ---
		try {
			const { SpiderEngine } = await import("../../../policy/spider/SpiderEngine")
			const engine = new SpiderEngine(config.cwd)
			await engine.loadRegistry()
			const node = engine.nodes.get(relPath as string)
			if (node) {
				const intentRegex = /\[INTEGRITY_INTENT:\s*(.*?)\]/
				const intentMatch = fileContent.text.match(intentRegex)
				const intent = intentMatch ? intentMatch[1] : "Not explicitly documented."

				const contextBlock =
					`\n\n[STABILITY_CONTEXT]\n` +
					`Layer: ${node.layer?.toUpperCase() || "UNKNOWN"}\n` +
					`Architectural Intent: ${intent}\n` +
					`Metrics: Logic Density: ${SafeNumber.format(node.logicDensity, 2)}, I/O Entropy: ${SafeNumber.format(node.ioEntropy, 2)}\n` +
					`Status: ${node.orphaned ? "ORPHANED" : "INTEGRATED"}\n`
				fileContent.text += contextBlock
			}
		} catch (_e) {
			// Fail silent for context injection
		}

		return fileContent.text
	}
}
