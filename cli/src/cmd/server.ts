import { existsSync } from "node:fs"
import path from "node:path"
import { buildRemoteUi } from "../server/build.js"
import { cmd } from "./cmd"

export const ServerCommand = cmd({
	command: "server",
	describe: "Start the remote control server",
	builder: (yargs) =>
		yargs
			.option("port", { type: "string", describe: "Port to listen on", default: "26042" })
			.option("host", { type: "string", describe: "Host to listen on", default: "127.0.0.1" })
			.option("build", { type: "boolean", describe: "Build the webview-ui for remote platform" }),
	async handler(args) {
		const { initializeCli } = await import("../index")
		const { RemoteServer } = await import("../server/RemoteServer")

		const ctx = await initializeCli({ ...args, enableAuth: true, isRemote: true })

		let staticPath = path.join(ctx.extensionDir, "remote-ui", "dist")
		if (!existsSync(staticPath)) {
			staticPath = path.join(ctx.extensionDir, "..", "remote-ui", "dist")
		}

		if (
			args.build ||
			(!existsSync(staticPath) && existsSync(path.join(ctx.extensionDir, "..", "remote-ui", "package.json")))
		) {
			await buildRemoteUi(ctx.extensionDir)
		}

		const port = Number.parseInt(args.port as string, 10)
		const host = args.host as string
		const server = new RemoteServer(ctx.controller, { port, host, staticPath })

		await server.start({ port, host })
	},
})
