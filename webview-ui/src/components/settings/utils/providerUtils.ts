import {
	ApiConfiguration,
	ApiProvider,
	clinePassDefaultModelId,
	clinePassModels,
	cloudflareDefaultModelId,
	cloudflareModels,
	ModelInfo,
	nousResearchDefaultModelId,
	nousResearchModels,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	xaiDefaultModelId,
	xaiModels,
} from "@shared/api"
import { Mode } from "@shared/storage/types"
import * as reasoningSupport from "@shared/utils/reasoning-support"

export function supportsReasoningEffortForModelId(modelId?: string, _allowShortOpenAiIds = false): boolean {
	return reasoningSupport.supportsReasoningEffortForModel(modelId)
}

/**
 * Returns the static model list for a provider.
 * For providers with dynamic models (openrouter, dietcode, ollama, etc.), returns undefined.
 */
export function getModelsForProvider(
	provider: ApiProvider,
	_apiConfiguration?: ApiConfiguration,
	_dynamicModels: { liteLlmModels?: Record<string, ModelInfo>; basetenModels?: Record<string, ModelInfo> } = {},
): Record<string, ModelInfo> | undefined {
	switch (provider) {
		case "cloudflare":
			return cloudflareModels
		case "openai-codex":
			return openAiCodexModels
		case "nousResearch":
			return nousResearchModels
		case "cline-pass":
			return clinePassModels
		case "xai-oauth":
			return xaiModels
		default:
			return undefined
	}
}

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
}

/**
 * Normalizes API configuration to ensure consistent values
 */
export function normalizeApiConfiguration(
	apiConfiguration: ApiConfiguration | undefined,
	currentMode: Mode,
): NormalizedApiConfig {
	const provider =
		(currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "openrouter"

	const modelId = currentMode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string) => {
		let selectedModelId: string
		let selectedModelInfo: ModelInfo
		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}
		return {
			selectedProvider: provider as ApiProvider,
			selectedModelId,
			selectedModelInfo,
		}
	}

	switch (provider) {
		case "cloudflare":
			return getProviderData(cloudflareModels, cloudflareDefaultModelId)
		case "cline-pass":
			return getProviderData(clinePassModels, clinePassDefaultModelId)
		case "openai-codex":
			return getProviderData(openAiCodexModels, openAiCodexDefaultModelId)
		case "xai-oauth":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "openrouter":
			const openRouterModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOpenRouterModelId : apiConfiguration?.actModeOpenRouterModelId
			const openRouterModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "nousResearch":
			const nousResearchModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeNousResearchModelId
					: apiConfiguration?.actModeNousResearchModelId
			return {
				selectedProvider: provider,
				selectedModelId: nousResearchModelId || nousResearchDefaultModelId,
				selectedModelInfo:
					nousResearchModelId && nousResearchModelId in nousResearchModels
						? nousResearchModels[nousResearchModelId as keyof typeof nousResearchModels]
						: nousResearchModels[nousResearchDefaultModelId],
			}
		default:
			return {
				selectedProvider: "openrouter" as ApiProvider,
				selectedModelId: openRouterDefaultModelId,
				selectedModelInfo: openRouterDefaultModelInfo,
			}
	}
}

/**
 * Gets mode-specific field values from API configuration
 * @param apiConfiguration The API configuration object
 * @param mode The current mode ("plan" or "act")
 * @returns Object containing mode-specific field values for clean destructuring
 */
export function getModeSpecificFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode) {
	if (!apiConfiguration) {
		return {
			// Core fields
			apiProvider: undefined,
			apiModelId: undefined,

			// Provider-specific model IDs
			openRouterModelId: undefined,
			nousResearchModelId: undefined,
			clinePassModelId: undefined,

			// Model info objects
			openRouterModelInfo: undefined,

			// Other mode-specific fields
			thinkingBudgetTokens: undefined,
			reasoningEffort: undefined,
		}
	}

	const openRouterModelId =
		mode === "plan" ? apiConfiguration.planModeOpenRouterModelId : apiConfiguration.actModeOpenRouterModelId
	const openRouterModelInfo =
		mode === "plan" ? apiConfiguration.planModeOpenRouterModelInfo : apiConfiguration.actModeOpenRouterModelInfo
	const clinePassModelId =
		mode === "plan" ? apiConfiguration.planModeClinePassModelId : apiConfiguration.actModeClinePassModelId

	return {
		// Core fields
		apiProvider: mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider,
		apiModelId: mode === "plan" ? apiConfiguration.planModeApiModelId : apiConfiguration.actModeApiModelId,

		// Provider-specific model IDs
		openRouterModelId,
		nousResearchModelId:
			mode === "plan" ? apiConfiguration.planModeNousResearchModelId : apiConfiguration.actModeNousResearchModelId,
		clinePassModelId,

		// Model info objects
		openRouterModelInfo,

		// Other mode-specific fields
		thinkingBudgetTokens:
			mode === "plan" ? apiConfiguration.planModeThinkingBudgetTokens : apiConfiguration.actModeThinkingBudgetTokens,
		reasoningEffort: mode === "plan" ? apiConfiguration.planModeReasoningEffort : apiConfiguration.actModeReasoningEffort,
	}
}

/**
 * Synchronizes mode configurations by copying the source mode's settings to both modes
 * This is used when the "Use different models for Plan and Act modes" toggle is unchecked
 */
export async function syncModeConfigurations(
	apiConfiguration: ApiConfiguration | undefined,
	sourceMode: Mode,
	handleFieldsChange: (updates: Partial<ApiConfiguration>) => Promise<void>,
): Promise<void> {
	if (!apiConfiguration) {
		return
	}

	const sourceFields = getModeSpecificFields(apiConfiguration, sourceMode)
	const { apiProvider } = sourceFields

	if (!apiProvider) {
		return
	}

	// Build the complete update object with both plan and act mode fields
	const updates: Partial<ApiConfiguration> = {
		// Always sync common fields
		planModeApiProvider: sourceFields.apiProvider,
		actModeApiProvider: sourceFields.apiProvider,
		planModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		actModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		planModeReasoningEffort: sourceFields.reasoningEffort,
		actModeReasoningEffort: sourceFields.reasoningEffort,
	}

	// Handle provider-specific fields
	switch (apiProvider) {
		case "openrouter":
			updates.planModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.actModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.planModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			updates.actModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			break
		case "nousResearch":
			updates.planModeNousResearchModelId = sourceFields.nousResearchModelId
			updates.actModeNousResearchModelId = sourceFields.nousResearchModelId
			break
		case "cline-pass":
			updates.planModeClinePassModelId = sourceFields.clinePassModelId
			updates.actModeClinePassModelId = sourceFields.clinePassModelId
			break
		default:
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			break
	}

	// Make the atomic update
	await handleFieldsChange(updates)
}

export { filterOpenRouterModelIds } from "@shared/utils/model-filters"

// Helper to get provider-specific configuration info and empty state guidance
export const getProviderInfo = (
	_provider: ApiProvider,
	_apiConfiguration: ApiConfiguration,
	_effectiveMode: "plan" | "act",
): { modelId?: string; baseUrl?: string; helpText: string } => {
	return {
		modelId: undefined,
		baseUrl: undefined,
		helpText: "Configure this provider in model settings",
	}
}
