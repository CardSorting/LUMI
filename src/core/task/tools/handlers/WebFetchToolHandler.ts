import { DietCodeSayTool } from "@shared/ExtensionMessage"
import { DietCodeDefaultTool } from "@shared/tools"
import axios from "axios"
import { DietCodeEnv } from "@/config"
import { AuthService } from "@/services/auth/AuthService"
import { buildDietCodeExtraHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { DIETCODE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/DietCodeAccount"
import { getAxiosSettings } from "@/shared/net"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IPartialBlockHandler, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class WebFetchToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.WEB_FETCH

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.url}']`
	}

	getApprovalIntent(block: ToolUse) {
		return declareApprovalIntent(block, {
			description: `Fetch web content from ${block.params.url ?? ""}`,
			requirements: [
				{
					capability: "network",
					risk: "elevated",
					requestedSideEffects: ["external network request"],
					autoApprovalEligible: true,
				},
			],
			notification: `DietCode wants to fetch content from ${block.params.url ?? "the web"}`,
		})
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const url = block.params.url || ""
		const sharedMessageProps: DietCodeSayTool = {
			tool: "webFetch",
			path: uiHelpers.removeClosingTag(block, "url", url),
			content: `Fetching URL: ${uiHelpers.removeClosingTag(block, "url", url)}`,
			operationIsLocatedInWorkspace: false, // web_fetch is always external
		} satisfies DietCodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// For partial blocks, we'll let the ToolExecutor handle auto-approval logic
		// Just stream the UI update for now
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const url: string | undefined = block.params.url
			const prompt: string | undefined = block.params.prompt

			// Extract provider information for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			// Check if DietCode web tools are enabled (both user setting and feature flag)
			const dietcodeWebToolsEnabled = config.services.stateManager.getGlobalSettingsKey("dietcodeWebToolsEnabled")
			const featureFlagEnabled = featureFlagsService.getWebtoolsEnabled()
			if (provider !== "dietcode" || !dietcodeWebToolsEnabled || !featureFlagEnabled) {
				return formatResponse.toolError("DietCode web tools are currently disabled.")
			}

			// Validate required parameters
			if (!url) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "url")
			}
			if (!prompt) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt")
			}
			config.taskState.consecutiveMistakeCount = 0

			// Execute the actual fetch
			const baseUrl = DietCodeEnv.config().apiBaseUrl
			const authToken = await AuthService.getInstance().getAuthToken()

			if (!authToken) {
				throw new Error(DIETCODE_ACCOUNT_AUTH_ERROR_MESSAGE)
			}

			const response = await axios.post(
				`${baseUrl}/api/v1/search/webfetch`,
				{
					Url: url,
					Prompt: prompt,
				},
				{
					headers: {
						Authorization: `Bearer ${authToken}`,
						"Content-Type": "application/json",
						"X-Task-ID": config.ulid || "",
						...(await buildDietCodeExtraHeaders()),
					},
					timeout: 15000,
					...getAxiosSettings(),
				},
			)

			// Parse response
			// Axios will throw on non-200 status, so no need to check fetchStatus
			const result = response.data.data.result

			return formatResponse.toolResult(result)
		} catch (error) {
			return `Error fetching web content: ${(error as Error).message}`
		}
	}
}
