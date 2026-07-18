import {
	OpenRouterModelInfo,
	ModelsApiConfiguration as ProtoApiConfiguration,
	ApiProvider as ProtoApiProvider,
	ThinkingConfig,
} from "@shared/proto/dietcode/models"
import { ApiConfiguration, ApiProvider, ModelInfo } from "../../api"

// Convert application ThinkingConfig to proto ThinkingConfig
function convertThinkingConfigToProto(config: ModelInfo["thinkingConfig"]): ThinkingConfig | undefined {
	if (!config) {
		return undefined
	}

	return {
		maxBudget: config.maxBudget,
		outputPrice: config.outputPrice,
		outputPriceTiers: config.outputPriceTiers || [], // Provide empty array if undefined
	}
}

// Convert proto ThinkingConfig to application ThinkingConfig
function convertProtoToThinkingConfig(config: ThinkingConfig | undefined): ModelInfo["thinkingConfig"] | undefined {
	if (!config) {
		return undefined
	}

	return {
		maxBudget: config.maxBudget,
		outputPrice: config.outputPrice,
		outputPriceTiers: config.outputPriceTiers.length > 0 ? config.outputPriceTiers : undefined,
	}
}

// Convert application ModelInfo to proto OpenRouterModelInfo
function convertModelInfoToProtoOpenRouter(info: ModelInfo | undefined): OpenRouterModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache ?? false,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		thinkingConfig: convertThinkingConfigToProto(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		tiers: info.tiers || [],
	}
}

// Convert proto OpenRouterModelInfo to application ModelInfo
function convertProtoToModelInfo(info: OpenRouterModelInfo | undefined): ModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		thinkingConfig: convertProtoToThinkingConfig(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		tiers: info.tiers.length > 0 ? info.tiers : undefined,
	}
}

// Convert application ApiProvider to proto ApiProvider
function convertApiProviderToProto(provider: string | undefined): ProtoApiProvider {
	switch (provider) {
		case "openrouter":
			return ProtoApiProvider.OPENROUTER
		case "openai":
			return ProtoApiProvider.OPENAI
		case "gemini":
			return ProtoApiProvider.GEMINI
		case "nousResearch":
			return ProtoApiProvider.NOUSRESEARCH
		case "openai-codex":
			return ProtoApiProvider.OPENAI_CODEX
		case "cloudflare":
			return ProtoApiProvider.CLOUDFLARE
		case "cerebras":
			return ProtoApiProvider.CEREBRAS
		case "cline-pass":
			return ProtoApiProvider.CLINE_PASS
		case "xai-oauth":
			return ProtoApiProvider.XAI_OAUTH
		default:
			return ProtoApiProvider.OPENROUTER
	}
}

// Convert proto ApiProvider to application ApiProvider
export function convertProtoToApiProvider(provider: ProtoApiProvider): ApiProvider {
	switch (provider) {
		case ProtoApiProvider.OPENROUTER:
			return "openrouter"
		case ProtoApiProvider.OPENAI:
			return "openai"
		case ProtoApiProvider.GEMINI:
			return "gemini"
		case ProtoApiProvider.NOUSRESEARCH:
			return "nousResearch"
		case ProtoApiProvider.OPENAI_CODEX:
			return "openai-codex"
		case ProtoApiProvider.CLOUDFLARE:
			return "cloudflare"
		case ProtoApiProvider.CEREBRAS:
			return "cerebras"
		case ProtoApiProvider.CLINE_PASS:
			return "cline-pass"
		case ProtoApiProvider.XAI_OAUTH:
			return "xai-oauth"
		default:
			return "openrouter"
	}
}

// Converts application ApiConfiguration to proto ApiConfiguration
export function convertApiConfigurationToProto(config: ApiConfiguration): ProtoApiConfiguration {
	return {
		// Global configuration fields
		apiKey: config.apiKey,
		dietcodeAccountId: config.dietcodeAccountId,
		ulid: config.ulid,
		openAiHeaders: config.openAiHeaders || {},
		openRouterApiKey: config.openRouterApiKey,
		openRouterProviderSorting: config.openRouterProviderSorting,
		xaiApiKey: config.xaiApiKey,
		nousResearchApiKey: config.nousResearchApiKey,
		cloudflareAccountId: config.cloudflareAccountId,
		cloudflareApiToken: config.cloudflareApiToken,
		cerebrasApiKey: config.cerebrasApiKey,
		clineApiKey: config.clineApiKey,
		embeddingProvider: config.embeddingProvider ? convertApiProviderToProto(config.embeddingProvider) : undefined,
		embeddingModelId: config.embeddingModelId,
		embeddingApiKey: config.embeddingApiKey,
		embeddingOpenAiBaseUrl: config.embeddingOpenAiBaseUrl,

		// Plan mode configurations
		planModeApiProvider: config.planModeApiProvider ? convertApiProviderToProto(config.planModeApiProvider) : undefined,
		planModeApiModelId: config.planModeApiModelId,
		planModeThinkingBudgetTokens: config.planModeThinkingBudgetTokens,
		planModeReasoningEffort: config.planModeReasoningEffort,
		planModeOpenRouterModelId: config.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.planModeOpenRouterModelInfo),
		planModeNousResearchModelId: config.planModeNousResearchModelId,
		planModeClinePassModelId: config.planModeClinePassModelId,
		planModeClinePassModelInfo: convertModelInfoToProtoOpenRouter(config.planModeClinePassModelInfo),

		// Act mode configurations
		actModeApiProvider: config.actModeApiProvider ? convertApiProviderToProto(config.actModeApiProvider) : undefined,
		actModeApiModelId: config.actModeApiModelId,
		actModeThinkingBudgetTokens: config.actModeThinkingBudgetTokens,
		actModeReasoningEffort: config.actModeReasoningEffort,
		actModeOpenRouterModelId: config.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.actModeOpenRouterModelInfo),
		actModeNousResearchModelId: config.actModeNousResearchModelId,
		actModeClinePassModelId: config.actModeClinePassModelId,
		actModeClinePassModelInfo: convertModelInfoToProtoOpenRouter(config.actModeClinePassModelInfo),
	}
}

// Converts proto ApiConfiguration to application ApiConfiguration
export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	return {
		// Global configuration fields
		apiKey: protoConfig.apiKey,
		dietcodeAccountId: protoConfig.dietcodeAccountId,
		ulid: protoConfig.ulid,
		openAiHeaders: Object.keys(protoConfig.openAiHeaders || {}).length > 0 ? protoConfig.openAiHeaders : undefined,
		openRouterApiKey: protoConfig.openRouterApiKey,
		openRouterProviderSorting: protoConfig.openRouterProviderSorting,
		xaiApiKey: protoConfig.xaiApiKey,
		nousResearchApiKey: protoConfig.nousResearchApiKey,
		cloudflareAccountId: protoConfig.cloudflareAccountId,
		cloudflareApiToken: protoConfig.cloudflareApiToken,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		clineApiKey: protoConfig.clineApiKey,
		embeddingProvider:
			protoConfig.embeddingProvider !== undefined ? convertProtoToApiProvider(protoConfig.embeddingProvider) : undefined,
		embeddingModelId: protoConfig.embeddingModelId,
		embeddingApiKey: protoConfig.embeddingApiKey,
		embeddingOpenAiBaseUrl: protoConfig.embeddingOpenAiBaseUrl,

		// Plan mode configurations
		planModeApiProvider:
			protoConfig.planModeApiProvider !== undefined
				? convertProtoToApiProvider(protoConfig.planModeApiProvider)
				: undefined,
		planModeApiModelId: protoConfig.planModeApiModelId,
		planModeThinkingBudgetTokens: protoConfig.planModeThinkingBudgetTokens,
		planModeReasoningEffort: protoConfig.planModeReasoningEffort,
		planModeOpenRouterModelId: protoConfig.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertProtoToModelInfo(protoConfig.planModeOpenRouterModelInfo),
		planModeNousResearchModelId: protoConfig.planModeNousResearchModelId,
		planModeClinePassModelId: protoConfig.planModeClinePassModelId,
		planModeClinePassModelInfo: convertProtoToModelInfo(protoConfig.planModeClinePassModelInfo),

		// Act mode configurations
		actModeApiProvider:
			protoConfig.actModeApiProvider !== undefined ? convertProtoToApiProvider(protoConfig.actModeApiProvider) : undefined,
		actModeApiModelId: protoConfig.actModeApiModelId,
		actModeThinkingBudgetTokens: protoConfig.actModeThinkingBudgetTokens,
		actModeReasoningEffort: protoConfig.actModeReasoningEffort,
		actModeOpenRouterModelId: protoConfig.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertProtoToModelInfo(protoConfig.actModeOpenRouterModelInfo),
		actModeNousResearchModelId: protoConfig.actModeNousResearchModelId,
		actModeClinePassModelId: protoConfig.actModeClinePassModelId,
		actModeClinePassModelInfo: convertProtoToModelInfo(protoConfig.actModeClinePassModelInfo),
	}
}
