import { exit } from "node:process"
import * as prompts from "@clack/prompts"
import chalk from "chalk"
import { getProviderLabel, getValidCliProviders } from "../utils/providers"
import { cmd } from "./cmd"

export const ProvidersCommand = cmd({
	command: "providers",
	describe: "List supported LLM providers",
	async handler(args) {
		const { initializeCli, disposeCliContext } = await import("../index")
		const ctx = await initializeCli({ ...args, enableAuth: true })

		prompts.intro("Supported Providers")

		const providers = getValidCliProviders()
		for (const p of providers) {
			prompts.log.info(`- ${chalk.cyan(p)}: ${getProviderLabel(p)}`)
		}

		prompts.outro("Use dietcode auth --provider <name> to switch")
		await disposeCliContext(ctx)
		exit(0)
	},
})
