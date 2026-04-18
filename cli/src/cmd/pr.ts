import { exit } from "node:process"
import * as prompts from "@clack/prompts"
import { Octokit } from "@octokit/rest"
import chalk from "chalk"
import { cmd } from "./cmd"

export const PrCommand = cmd({
	command: "pr",
	describe: "Manage Pull Requests",
	builder: (yargs) => yargs.command(PrListCommand).command(PrCheckoutCommand).demandCommand(),
	async handler() {},
})

const PrListCommand = cmd({
	command: "list",
	describe: "List open pull requests",
	async handler(args) {
		const { initializeCli, disposeCliContext } = await import("../index")
		const ctx = await initializeCli({ ...args, enableAuth: true })

		const token = process.env.GITHUB_TOKEN
		if (!token) {
			prompts.log.error("GITHUB_TOKEN environment variable is not set.")
			exit(1)
		}

		const octokit = new Octokit({ auth: token })
		prompts.intro("Pull Requests")

		const spinner = prompts.spinner()
		spinner.start("Fetching PRs...")

		try {
			const { execSync } = await import("node:child_process")
			const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim()
			const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/)

			if (!match) {
				spinner.stop("Could not determine repository from git remote")
				exit(1)
			}

			const [_, owner, repo] = match
			const { data: prs } = await octokit.rest.pulls.list({ owner, repo, state: "open" })

			spinner.stop("Fetched PRs")

			for (const pr of prs) {
				prompts.log.info(`${chalk.green(`#${pr.number}`)} ${pr.title} (${chalk.gray(pr.user?.login)})`)
				prompts.log.info(`  ${chalk.gray(pr.head.ref)} → ${chalk.gray(pr.base.ref)}`)
			}
		} catch (_error) {
			spinner.stop("Failed to fetch PRs")
		}

		prompts.outro("Done")
		await disposeCliContext(ctx)
		exit(0)
	},
})

const PrCheckoutCommand = cmd({
	command: "checkout <number>",
	describe: "Checkout a pull request branch",
	async handler(args) {
		const { execSync } = await import("node:child_process")
		const number = args.number as string
		prompts.log.info(`Checking out PR #${number}...`)
		try {
			execSync(`gh pr checkout ${number}`, { stdio: "inherit" })
		} catch (_error) {
			prompts.log.error(`Failed to checkout PR #${number}. Ensure gh CLI is installed.`)
		}
		exit(0)
	},
})
