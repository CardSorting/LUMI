import { exit } from "node:process"
import * as prompts from "@clack/prompts"
import chalk from "chalk"
import { StateManager } from "@/core/storage/StateManager"
import { cmd } from "./cmd"

export const ModelsCommand = cmd({
	command: "models [provider]",
	describe: "List available models for a provider",
	builder: (yargs) =>
		yargs
			.positional("provider", { type: "string", describe: "Provider ID (e.g. openrouter, anthropic)" })
			.option("refresh", { type: "boolean", describe: "Refresh models cache from provider API" }),
	async handler(args) {
		const { initializeCli, disposeCliContext } = await import("../index")
		const ctx = await initializeCli({ ...args, enableAuth: true })

		const provider = (args.provider as string) || StateManager.get().getApiConfiguration().planModeApiProvider || "openrouter"
		prompts.intro(`Models for ${provider}`)

		const spinner = prompts.spinner()

		if (args.refresh) {
			spinner.start(`Refreshing models for ${provider}...`)
			try {
				if (provider === "openrouter") {
					const { refreshOpenRouterModels } = await import("@core/controller/models/refreshOpenRouterModels")
					await refreshOpenRouterModels(ctx.controller)
				}
				// Add other providers if needed
				spinner.stop("Refresh complete")
			} catch (_error) {
				spinner.stop("Refresh failed")
			}
		}

		// Try to get from cache
		const models = StateManager.get().getModelsCache(provider as any)

		if (!models) {
			prompts.log.warn(`No cached models found for ${provider}. Use --refresh to fetch them.`)
		} else {
			const sortedModels = Object.entries(models).sort((a, b) => a[0].localeCompare(b[0]))
			for (const [id, info] of sortedModels) {
				const priceText = info.inputPrice ? ` ($${(info.inputPrice / 1000000).toFixed(2)}/1M tokens)` : ""
				prompts.log.info(`- ${chalk.cyan(id)}: ${info.name}${priceText}`)
			}
		}

		prompts.outro("Done")
		await disposeCliContext(ctx)
		exit(0)
	},
})
