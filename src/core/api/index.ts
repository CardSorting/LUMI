import { ApiConfiguration } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { isE2ETestMode } from "@/shared/e2e-mode"
import { Logger } from "@/shared/services/Logger"
import { CloudflareHandler } from "./providers/cloudflare"
import { E2EMockOpenRouterHandler } from "./providers/e2e-mock-openrouter"
import { NousResearchHandler } from "./providers/nousresearch"
import { OpenAiCodexHandler } from "./providers/openai-codex"
import { OpenRouterHandler } from "./providers/openrouter"
import { ApiHandler, ApiHandlerModel, ApiProviderInfo, CommonApiHandlerOptions, SingleCompletionHandler } from "./types"

// Re-export the API handler contract for backward compatibility.
// The canonical definitions live in ./types to break the provider↔index cycle.
export type { ApiHandler, ApiHandlerModel, ApiProviderInfo, CommonApiHandlerOptions, SingleCompletionHandler }

function createHandlerForProvider(
	apiProvider: string | undefined,
	options: Omit<ApiConfiguration, "apiProvider">,
	mode: Mode,
): ApiHandler {
	switch (apiProvider) {
		case "openrouter":
			if (isE2ETestMode()) {
				return new E2EMockOpenRouterHandler({
					onRetryAttempt: options.onRetryAttempt,
					openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
					openRouterModelInfo:
						mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				})
			}
			return new OpenRouterHandler({
				onRetryAttempt: options.onRetryAttempt,
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "openai-codex":
			return new OpenAiCodexHandler({
				onRetryAttempt: options.onRetryAttempt,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "cloudflare":
			return new CloudflareHandler({
				onRetryAttempt: options.onRetryAttempt,
				cloudflareAccountId: options.cloudflareAccountId,
				cloudflareApiToken: options.cloudflareApiToken,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "nousResearch":
			return new NousResearchHandler({
				onRetryAttempt: options.onRetryAttempt,
				nousResearchApiKey: options.nousResearchApiKey,
				apiModelId: mode === "plan" ? options.planModeNousResearchModelId : options.actModeNousResearchModelId,
			})
		default:
			if (isE2ETestMode()) {
				return new E2EMockOpenRouterHandler({
					onRetryAttempt: options.onRetryAttempt,
					openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
					openRouterModelInfo:
						mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				})
			}
			return new OpenRouterHandler({
				onRetryAttempt: options.onRetryAttempt,
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
	}
}

export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const { planModeApiProvider, actModeApiProvider, ...options } = configuration

	const apiProvider = mode === "plan" ? planModeApiProvider : actModeApiProvider

	// Validate thinking budget tokens against model's maxTokens to prevent API errors
	// wrapped in a try-catch for safety, but this should never throw
	try {
		const thinkingBudgetTokens = mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens
		if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
			const handler = createHandlerForProvider(apiProvider, options, mode)

			const modelInfo = handler.getModel().info
			if (modelInfo?.maxTokens && modelInfo.maxTokens > 0 && thinkingBudgetTokens > modelInfo.maxTokens) {
				const clippedValue = modelInfo.maxTokens - 1
				if (mode === "plan") {
					options.planModeThinkingBudgetTokens = clippedValue
				} else {
					options.actModeThinkingBudgetTokens = clippedValue
				}
			} else {
				return handler // don't rebuild unless its necessary
			}
		}
	} catch (error) {
		Logger.error("buildApiHandler pre-flight check error:", error)
		// We continue anyway and return a fresh handler below
	}

	try {
		return createHandlerForProvider(apiProvider, options, mode)
	} catch (error) {
		Logger.error("buildApiHandler: CRITICAL failure in createHandlerForProvider", error)
		// Fallback to a safe default if even creation fails
		return createHandlerForProvider("openrouter", options, mode)
	}
}
