import { exit } from "node:process"
import React from "react"
import { StateManager } from "@/core/storage/StateManager"
import { telemetryService } from "@/services/telemetry"
import { checkRawModeSupport } from "../context/StdinContext"
import { cmd } from "./cmd"

export const ConfigCommand = cmd({
	command: "config",
	describe: "Show current configuration",
	async handler(args) {
		const { initializeCli, runInkApp, disposeCliContext } = await import("../index")
		const { ConfigViewWrapper } = await import("../components/ConfigViewWrapper")

		const ctx = await initializeCli({ ...args, enableAuth: true })
		const stateManager = StateManager.get()

		telemetryService.captureHostEvent("config_command", "executed")

		await runInkApp(
			React.createElement(ConfigViewWrapper, {
				controller: ctx.controller,
				dataDir: ctx.dataDir,
				globalState: stateManager.getAllGlobalStateEntries(),
				workspaceState: stateManager.getAllWorkspaceStateEntries(),
				hooksEnabled: true,
				skillsEnabled: true,
				isRawModeSupported: checkRawModeSupport(),
			}),
			async () => {
				await disposeCliContext(ctx)
				exit(0)
			},
		)
	},
})
