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
	const configured: ApiProvider[] = []

	if (remoteConfig?.remoteConfiguredProviders?.length) {
		configured.push(...remoteConfig.remoteConfiguredProviders)
	} else if (apiConfiguration) {
		if (apiConfiguration.cloudflareAccountId && apiConfiguration.cloudflareApiToken) {
			configured.push("cloudflare")
		}

		if (apiConfiguration.openRouterApiKey) {
			configured.push("openrouter")
		}

		if (apiConfiguration.cerebrasApiKey) {
			configured.push("cerebras")
		}

		if (apiConfiguration.nousResearchApiKey) {
			configured.push("nousResearch")
		}
	}

	// Always ensure local / subscription-based providers are allowed/configured
	if (!configured.includes("openai-codex")) {
		configured.push("openai-codex")
	}
	if (!configured.includes("cline-pass")) {
		configured.push("cline-pass")
	}
	if (!configured.includes("xai-oauth")) {
		configured.push("xai-oauth")
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
