import { ApiConfiguration, ModelInfo, openRouterDefaultModelId } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

export function validateApiConfiguration(currentMode: Mode, apiConfiguration?: ApiConfiguration): string | undefined {
	if (!apiConfiguration) {
		return undefined
	}

	const { apiProvider } = getModeSpecificFields(apiConfiguration, currentMode)

	switch (apiProvider) {
		case "cloudflare":
			if (!apiConfiguration.cloudflareAccountId || !apiConfiguration.cloudflareApiToken) {
				return "You must provide a valid Cloudflare Account ID and API Token."
			}
			break
		case "openai-codex":
		case "xai-oauth":
			// Authentication is handled via OAuth, not API key
			break
		case "openrouter":
			if (!apiConfiguration.openRouterApiKey) {
				return "You must provide a valid API key or choose a different provider."
			}
			break
		case "cerebras":
			if (!apiConfiguration.cerebrasApiKey) {
				return "You must provide a valid Cerebras API key."
			}
			break
		case "nousResearch":
			if (!apiConfiguration.nousResearchApiKey) {
				return "You must provide a valid API key or choose a different provider."
			}
			break
		case "cline-pass":
			if (!apiConfiguration.clineApiKey) {
				return "You must provide a valid Cline API key."
			}
			break
		case "qwen-token-plan":
			if (!apiConfiguration.qwenTokenPlanApiKey) {
				return "You must provide a valid Qwen Token Plan API key."
			}
			break
		case "zai":
			if (!apiConfiguration.zaiApiKey) {
				return "You must provide a valid Z AI API key."
			}
			break
	}

	return undefined
}

export function validateModelId(
	currentMode: Mode,
	apiConfiguration?: ApiConfiguration,
	openRouterModels?: Record<string, ModelInfo>,
): string | undefined {
	if (!apiConfiguration) {
		return undefined
	}

	const { apiProvider, openRouterModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	if (apiProvider === "openrouter") {
		const modelId = openRouterModelId || openRouterDefaultModelId
		if (!modelId) {
			return "You must provide a model ID."
		}
		if (openRouterModels && !Object.keys(openRouterModels).includes(modelId)) {
			return "The model ID you provided is not available. Please choose a different model."
		}
	}

	return undefined
}
