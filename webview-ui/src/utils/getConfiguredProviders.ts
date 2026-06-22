import type { ApiConfiguration, ApiProvider } from "@shared/api"
import PROVIDERS from "@shared/providers/providers.json"
import type { RemoteConfigFields } from "@shared/storage/state-keys"

/**
 * Returns a list of API providers that are configured (have required credentials/settings)
 */
export function getConfiguredProviders(
	remoteConfig: Partial<RemoteConfigFields> | undefined,
	apiConfiguration: ApiConfiguration | undefined,
): ApiProvider[] {
	if (remoteConfig?.remoteConfiguredProviders?.length) {
		return remoteConfig.remoteConfiguredProviders
	}

	const configured: ApiProvider[] = []

	if (!apiConfiguration) {
		return configured
	}

	if (apiConfiguration.cloudflareAccountId && apiConfiguration.cloudflareApiToken) {
		configured.push("cloudflare")
	}

	// OpenAI Codex - subscription-based OAuth, always available
	configured.push("openai-codex")

	if (apiConfiguration.openRouterApiKey) {
		configured.push("openrouter")
	}

	if (apiConfiguration.nousResearchApiKey) {
		configured.push("nousResearch")
	}

	return configured
}

/**
 * Get provider display label from provider value
 * Uses the canonical providers.json as source of truth
 */
export function getProviderLabel(provider: ApiProvider): string {
	const providerEntry = PROVIDERS.list.find((p) => p.value === provider)
	return providerEntry?.label || provider
}
