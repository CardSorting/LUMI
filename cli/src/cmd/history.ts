import { exit } from "node:process"
import React from "react"
import { StateManager } from "@/core/storage/StateManager"
import { telemetryService } from "@/services/telemetry"
import { App } from "../components/App"
import { checkRawModeSupport } from "../context/StdinContext"
import { printInfo } from "../utils/display"
import { cmd } from "./cmd"

export const HistoryCommand = cmd({
	command: "history",
	describe: "List task history",
	builder: (yargs) =>
		yargs
			.option("limit", { type: "number", describe: "Number of tasks to show", default: 10 })
			.option("page", { type: "number", describe: "Page number", default: 1 }),
	async handler(args) {
		const { initializeCli, runInkApp, disposeCliContext } = await import("../index")

		const ctx = await initializeCli({ ...args, enableAuth: true })
		const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
		const sortedHistory = [...taskHistory].sort((a, b) => (b.ts || 0) - (a.ts || 0))

		const limit = args.limit as number
		const initialPage = args.page as number
		const totalCount = sortedHistory.length
		const totalPages = Math.ceil(totalCount / limit)

		telemetryService.captureHostEvent("history_command", "executed")

		if (sortedHistory.length === 0) {
			printInfo("No task history found.")
			await disposeCliContext(ctx)
			exit(0)
		}

		await runInkApp(
			React.createElement(App, {
				view: "history",
				historyItems: [],
				historyAllItems: sortedHistory,
				controller: ctx.controller,
				historyPagination: { page: initialPage, totalPages, totalCount, limit },
				isRawModeSupported: checkRawModeSupport(),
			}),
			async () => {
				await disposeCliContext(ctx)
				exit(0)
			},
		)
	},
})
