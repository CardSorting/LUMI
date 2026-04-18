import { exit } from "node:process"
import * as prompts from "@clack/prompts"
import chalk from "chalk"
import { StateManager } from "@/core/storage/StateManager"
import { cmd } from "./cmd"

export const StatsCommand = cmd({
	command: "stats",
	describe: "Display usage statistics",
	builder: (yargs) =>
		yargs
			.option("days", { type: "number", describe: "Show stats for the last N days", default: 30 })
			.option("all", { type: "boolean", describe: "Show stats for all time" }),
	async handler(args) {
		const { initializeCli, disposeCliContext } = await import("../index")
		const ctx = await initializeCli({ ...args, enableAuth: true })

		prompts.intro("Usage Statistics")

		const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
		const days = args.all ? Number.POSITIVE_INFINITY : (args.days as number)
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

		const filteredHistory = args.all ? taskHistory : taskHistory.filter((item) => (item.ts || 0) > cutoff)

		if (filteredHistory.length === 0) {
			prompts.log.warn("No usage data found for the selected period.")
			await disposeCliContext(ctx)
			exit(0)
		}

		let totalTokensIn = 0
		let totalTokensOut = 0
		let totalCost = 0
		const totalTasks = filteredHistory.length

		for (const item of filteredHistory) {
			totalTokensIn += item.tokensIn || 0
			totalTokensOut += item.tokensOut || 0
			totalCost += item.totalCost || 0

			// Try to find provider/model info if available in history item metadata
			// In codemarie-new, history items might not have provider info directly
			// but we can aggregate what we have.
		}

		prompts.log.info(`${chalk.bold("Total Tasks:")} ${totalTasks}`)
		prompts.log.info(
			`${chalk.bold("Total Tokens:")} ${totalTokensIn + totalTokensOut} (${totalTokensIn} in, ${totalTokensOut} out)`,
		)
		prompts.log.info(`${chalk.bold("Total Cost:")} $${totalCost.toFixed(4)}`)

		prompts.outro("Done")
		await disposeCliContext(ctx)
		exit(0)
	},
})
