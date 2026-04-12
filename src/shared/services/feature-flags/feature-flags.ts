import type { FeatureFlagPayload } from "@/services/feature-flags/providers/IFeatureFlagsProvider"

export enum FeatureFlag {
	WEBTOOLS = "webtools",
	WORKTREES = "worktree-exp",
	// Feature flag for remote banner service
	REMOTE_BANNERS = "remote-banners",
	// Feature flag payload (milliseconds) controlling remote banner cache TTL
	EXTENSION_REMOTE_BANNERS_TTL = "extension_remote_banners_ttl",
	// Feature flag for DB-backed welcome banners (What's New modal)
	// When off, hardcoded welcome items are shown instead
	REMOTE_WELCOME_BANNERS = "remote-welcome-banners",
	// Feature flag for upstream DietCode recommended model cards
	DIETCODE_RECOMMENDED_MODELS_UPSTREAM = "dietcode-recommended-models-upstream",
	// Rollout flag for DietCode provider model sourcing:
	// off => OpenRouter model list, on => DietCode endpoint model list.
	EXTENSION_DIETCODE_MODELS_ENDPOINT = "extension_dietcode_models_endpoint",
	// Use the websocket mode for OpenAI native Responses API format
	OPENAI_RESPONSES_WEBSOCKET_MODE = "openai-responses-websocket-mode",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, FeatureFlagPayload>> = {
	[FeatureFlag.WEBTOOLS]: false,
	[FeatureFlag.WORKTREES]: false,
	[FeatureFlag.REMOTE_BANNERS]: process.env.E2E_TEST === "true" || process.env.IS_DEV === "true",
	[FeatureFlag.EXTENSION_REMOTE_BANNERS_TTL]: 24 * 60 * 60 * 1000,
	[FeatureFlag.REMOTE_WELCOME_BANNERS]: process.env.E2E_TEST === "true" || process.env.IS_DEV === "true",
	[FeatureFlag.DIETCODE_RECOMMENDED_MODELS_UPSTREAM]: false,
	[FeatureFlag.EXTENSION_DIETCODE_MODELS_ENDPOINT]: false,
	[FeatureFlag.OPENAI_RESPONSES_WEBSOCKET_MODE]: false,
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
