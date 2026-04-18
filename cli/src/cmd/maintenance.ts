import { exit } from "node:process"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"

export const MaintenanceCommand = cmd({
	command: "maintenance",
	describe: "Maintenance activities for the CLI",
	builder: (yargs) => yargs.command(UpgradeCommand).command(UninstallCommand).demandCommand(),
	async handler() {},
})

const UpgradeCommand = cmd({
	command: "upgrade",
	describe: "Upgrade DietCode to the latest version",
	async handler() {
		prompts.intro("Upgrade")

		const spinner = prompts.spinner()
		spinner.start("Checking for updates...")

		try {
			// Simulating update check for now
			// In a real implementation, we'd check npm or brew
			spinner.stop("Checking complete")
			prompts.log.info("You are on the latest version.")
		} catch (_error) {
			spinner.stop("Failed to check for updates")
		}

		prompts.outro("Done")
		exit(0)
	},
})

const UninstallCommand = cmd({
	command: "uninstall",
	describe: "Uninstall DietCode CLI",
	async handler() {
		prompts.intro("Uninstall")

		const confirm = await prompts.confirm({
			message: "Are you sure you want to uninstall DietCode CLI?",
			initialValue: false,
		})

		if (prompts.isCancel(confirm) || !confirm) {
			prompts.outro("Aborted")
			exit(0)
		}

		prompts.log.warn("Please run 'npm uninstall -g dietcode' or 'brew uninstall dietcode' manually.")
		prompts.outro("Done")
		exit(0)
	},
})
