import { exit } from "node:process"
import React from "react"
import { StateManager } from "@/core/storage/StateManager"
import { telemetryService } from "@/services/telemetry"
import { App } from "../components/App"
import { checkRawModeSupport } from "../context/StdinContext"
import { printWarning } from "../utils/display"
import { applyProviderConfig } from "../utils/provider-config"
import { getValidCliProviders, isValidCliProvider } from "../utils/providers"
import { cmd } from "./cmd"

/**
 * Auth command module
 */
export const AuthCommand = cmd({
	command: "auth",
	describe: "Authenticate with an LLM provider",
	builder: (yargs) =>
		yargs
			.option("provider", { type: "string", describe: "API provider" })
			.option("apikey", { type: "string", describe: "API key" })
			.option("modelid", { type: "string", describe: "Model ID" })
			.option("baseurl", { type: "string", describe: "Base URL (optional)" }),
	async handler(args) {
		const { initializeCli, runInkApp, disposeCliContext } = await import("../index")

		const ctx = await initializeCli({ ...args, enableAuth: true })
		const hasQuickSetupFlags = args.provider && args.apikey && args.modelid

		telemetryService.captureHostEvent("auth_command", hasQuickSetupFlags ? "quick_setup" : "interactive")

		if (hasQuickSetupFlags) {
			const result = await performQuickAuthSetup(ctx, {
				provider: args.provider as string,
				apikey: args.apikey as string,
				modelid: args.modelid as string,
				baseurl: args.baseurl as string,
			})

			if (!result.success) {
				printWarning(result.error || "Quick setup failed")
				await telemetryService.captureHostEvent("auth", "error")
				await disposeCliContext(ctx)
				exit(1)
			}

			await telemetryService.captureHostEvent("auth", "completed")
			await disposeCliContext(ctx)
			exit(0)
		}

		// Interactive mode
		let authError = false
		await runInkApp(
			React.createElement(App, {
				view: "auth",
				controller: ctx.controller,
				isRawModeSupported: checkRawModeSupport(),
				onComplete: () => {
					telemetryService.captureHostEvent("auth", "completed")
				},
				onError: () => {
					telemetryService.captureHostEvent("auth", "error")
					authError = true
				},
			}),
			async () => {
				await disposeCliContext(ctx)
				exit(authError ? 1 : 0)
			},
		)
	},
})

/**
 * Quick auth setup without UI
 */
async function performQuickAuthSetup(
	ctx: { controller: any },
	options: { provider: string; apikey: string; modelid: string; baseurl?: string },
): Promise<{ success: boolean; error?: string }> {
	const { provider, apikey, modelid, baseurl } = options
	const normalizedProvider = provider.toLowerCase().trim()

	if (!isValidCliProvider(normalizedProvider)) {
		const validProviders = getValidCliProviders()
		return { success: false, error: `Invalid provider '${provider}'. Supported providers: ${validProviders.join(", ")}` }
	}

	await applyProviderConfig({
		providerId: normalizedProvider,
		apiKey: apikey,
		modelId: modelid,
		baseUrl: baseurl,
		controller: ctx.controller,
	})

	StateManager.get().setGlobalState("welcomeViewCompleted", true)
	await StateManager.get().flushPendingState()

	return { success: true }
}
