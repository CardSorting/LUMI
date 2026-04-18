import { exit } from "node:process"
import * as prompts from "@clack/prompts"
import { Octokit } from "@octokit/rest"
import chalk from "chalk"
import { cmd } from "./cmd"

export const GithubCommand = cmd({
	command: "github",
	describe: "GitHub integration commands",
	builder: (yargs) => yargs.command(GithubListIssuesCommand).command(GithubShowIssueCommand).demandCommand(),
	async handler() {},
})

const GithubListIssuesCommand = cmd({
	command: "list",
	describe: "List GitHub issues in the current repository",
	async handler(args) {
		const { initializeCli, disposeCliContext } = await import("../index")
		const ctx = await initializeCli({ ...args, enableAuth: true })

		const token = process.env.GITHUB_TOKEN
		if (!token) {
			prompts.log.error("GITHUB_TOKEN environment variable is not set.")
			exit(1)
		}

		const octokit = new Octokit({ auth: token })
		prompts.intro("GitHub Issues")

		const spinner = prompts.spinner()
		spinner.start("Fetching issues...")

		try {
			// Extract owner/repo from remote
			const { execSync } = await import("node:child_process")
			const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim()
			const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/)

			if (!match) {
				spinner.stop("Could not determine repository from git remote")
				exit(1)
			}

			const [_, owner, repo] = match
			const { data: issues } = await octokit.rest.issues.listForRepo({ owner, repo, state: "open" })

			spinner.stop("Fetched issues")

			for (const issue of issues) {
				if (issue.pull_request) continue // Skip PRs in issues list
				prompts.log.info(`${chalk.green(`#${issue.number}`)} ${issue.title} (${chalk.gray(issue.user?.login)})`)
			}
		} catch (_error) {
			spinner.stop("Failed to fetch issues")
		}

		prompts.outro("Done")
		await disposeCliContext(ctx)
		exit(0)
	},
})

const GithubShowIssueCommand = cmd({
	command: "show <number>",
	describe: "Show details of a specific issue",
	async handler(_args) {
		// ... implementation for showing issue details
		exit(0)
	},
})
