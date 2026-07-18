import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { createAndOpenGitHubIssue } from "@utils/github-url-utils"
import * as os from "os"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { Logger } from "@/shared/services/Logger"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IPartialBlockHandler, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class ReportBugHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.REPORT_BUG

	getApprovalIntent(block: ToolUse) {
		return declareApprovalIntent(block, {
			description: `Open an external GitHub issue draft for ${block.params.title ?? "a bug report"}`,
			requirements: [
				{
					capability: "network",
					risk: "elevated",
					requestedSideEffects: ["open a pre-filled external issue URL"],
					autoApprovalEligible: false,
				},
			],
			promptType: this.name,
			promptMessage: JSON.stringify({
				title: block.params.title,
				what_happened: block.params.what_happened,
				steps_to_reproduce: block.params.steps_to_reproduce,
				api_request_output: block.params.api_request_output,
				additional_context: block.params.additional_context,
			}),
		})
	}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const partialMessage = JSON.stringify({
			title: uiHelpers.removeClosingTag(block, "title", block.params.title),
			what_happened: uiHelpers.removeClosingTag(block, "what_happened", block.params.what_happened),
			steps_to_reproduce: uiHelpers.removeClosingTag(block, "steps_to_reproduce", block.params.steps_to_reproduce),
			api_request_output: uiHelpers.removeClosingTag(block, "api_request_output", block.params.api_request_output),
			additional_context: uiHelpers.removeClosingTag(block, "additional_context", block.params.additional_context),
		})

		await uiHelpers.say("text", partialMessage, undefined, undefined, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const title = block.params.title
		const what_happened = block.params.what_happened
		const steps_to_reproduce = block.params.steps_to_reproduce
		const api_request_output = block.params.api_request_output
		const additional_context = block.params.additional_context

		// Validate required parameters
		if (!title) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "title")
		}
		if (!what_happened) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "what_happened")
		}
		if (!steps_to_reproduce) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "steps_to_reproduce")
		}
		if (!api_request_output) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "api_request_output")
		}
		if (!additional_context) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "additional_context")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Derive system information values algorithmically
		const operatingSystem = `${os.platform()} ${os.release()}`
		const currentMode = config.mode
		const dietcodeVersion = ExtensionRegistryInfo.version
		const host = await HostProvider.env.getHostVersion({})
		const systemInfo = `${host.platform}: ${host.version}, Node.js: ${process.version}, Architecture: ${os.arch()}`
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const apiProvider = currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		const providerAndModel = `${apiProvider} / ${config.api.getModel().id}`

		// ExecutionFunnel recorded explicit consent before opening the external URL.
		try {
			// Create a Map of parameters for the GitHub issue
			const params = new Map<string, string>()
			params.set("title", title)
			params.set("operating-system", operatingSystem)
			params.set("dietcode-version", dietcodeVersion)
			params.set("system-info", systemInfo)
			params.set("additional-context", additional_context)
			params.set("what-happened", what_happened)
			params.set("steps", steps_to_reproduce)
			params.set("provider-model", providerAndModel)
			params.set("logs", api_request_output)

			// Use our utility function to create and open the GitHub issue URL
			// This bypasses VS Code's URI handling issues with special characters
			await createAndOpenGitHubIssue("dietcode", "dietcode", "bug_report.yml", params)
		} catch (error) {
			Logger.error(`An error occurred while attempting to report the bug: ${error}`)
		}

		return formatResponse.toolResult(`The user accepted the creation of the Github issue.`)
	}
}
