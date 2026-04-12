import express from "express"
import { createServer, Server } from "http"
import path from "path"
import { WebSocket, WebSocketServer } from "ws"
import { Controller } from "@/core/controller"
import { handleGrpcRequest } from "@/core/controller/grpc-handler"
import { RemoteWebviewProvider } from "@/core/webview/RemoteWebviewProvider"
import { Logger } from "@/shared/services/Logger"

export interface RemoteServerOptions {
	port: number
	host: string
	staticPath?: string
}

export class RemoteServer {
	private app: express.Express
	private server: Server
	private wss: WebSocketServer
	private controller: Controller
	private webviewProvider: RemoteWebviewProvider

	constructor(controller: Controller, options: RemoteServerOptions) {
		this.controller = controller
		this.app = express()
		this.server = createServer(this.app)
		this.wss = new WebSocketServer({ server: this.server })

		// We need a webview provider that's specific to this remote connection
		this.webviewProvider = controller.context.subscriptions.find(
			(s) => s instanceof RemoteWebviewProvider,
		) as RemoteWebviewProvider

		this.setupHttp(options)
		this.setupWebSockets()
	}

	private setupHttp(options: RemoteServerOptions) {
		this.app.get("/health", (_req, res) => {
			res.json({ status: "ok" })
		})

		// Simple token-based auth middleware
		const authToken = process.env.CODEMARIE_REMOTE_AUTH_TOKEN
		if (authToken) {
			this.app.use((req, res, next) => {
				// Don't require token for health check
				if (req.path === "/health") {
					return next()
				}

				const token = req.query.token || req.headers["x-auth-token"]
				if (token !== authToken) {
					Logger.warn(`[RemoteServer] Unauthorized request to ${req.path}`)
					res.status(401).send("Unauthorized")
					return
				}
				next()
			})
		}

		if (options.staticPath) {
			const staticPath = path.resolve(options.staticPath)
			Logger.info(`[RemoteServer] Serving static files from ${staticPath}`)
			this.app.use(express.static(staticPath))
			this.app.get("*", (req, res) => {
				if (path.extname(req.path)) {
					res.status(404).send("Not Found")
					return
				}
				res.sendFile(path.join(staticPath, "index.html"))
			})
		}
	}

	private setupWebSockets() {
		this.wss.on("connection", (ws: WebSocket, req) => {
			// Validate token for WebSocket connection
			const authToken = process.env.CODEMARIE_REMOTE_AUTH_TOKEN
			if (authToken) {
				const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`)
				const token = url.searchParams.get("token")
				if (token !== authToken) {
					Logger.warn("[RemoteServer] Unauthorized WebSocket connection attempt")
					ws.close(1008, "Unauthorized")
					return
				}
			}

			Logger.info("[RemoteServer] New WebSocket connection")
			this.webviewProvider.setSocket(ws)

			ws.on("message", async (data: Buffer | string) => {
				try {
					const messageStr = data.toString()
					const message = JSON.parse(messageStr)
					Logger.debug("[RemoteServer] Received message:", message.command)

					if (message.type === "grpc_request") {
						// Bridge gRPC requests from webapp to the controller
						await handleGrpcRequest(
							this.controller,
							(msg) => {
								ws.send(JSON.stringify(msg))
								return Promise.resolve(true)
							},
							message.grpc_request,
						)
					} else if (message.command === "init") {
						// Handle initialization if needed
						const state = await this.controller.getStateToPostToWebview()
						ws.send(JSON.stringify({ type: "state", state }))
					}
				} catch (error) {
					Logger.error("[RemoteServer] Error handling WS message:", error)
				}
			})

			ws.on("close", () => {
				Logger.info("[RemoteServer] WebSocket connection closed")
				this.webviewProvider.setSocket(null)
			})
		})
	}

	public start(options: RemoteServerOptions) {
		this.server.listen(options.port, options.host, () => {
			Logger.info(`[RemoteServer] Listening on http://${options.host}:${options.port}`)
		})
	}

	public stop() {
		this.wss.close()
		this.server.close()
	}
}
