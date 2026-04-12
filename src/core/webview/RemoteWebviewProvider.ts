/**
 * RemoteWebviewProvider implementation for remote control.
 * Bridges communication between the Controller and a WebSocket client.
 */
import type { WebSocket } from "ws"
import type { CodemarieExtensionContext } from "@/shared/codemarie"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { WebviewMessage } from "@/shared/WebviewMessage"
import { WebviewProvider } from "./WebviewProvider"

export class RemoteWebviewProvider extends WebviewProvider {
	private socket: WebSocket | null = null
	private messageQueue: ExtensionMessage[] = []

	constructor(context: CodemarieExtensionContext) {
		super(context)
		Logger.info("[RemoteWebviewProvider] Initialized")
	}

	/**
	 * Set the active socket for this provider
	 */
	async setSocket(socket: WebSocket | null) {
		this.socket = socket

		if (this.socket) {
			Logger.info("[RemoteWebviewProvider] Socket connected")

			// Always resync state on new connection or reconnection
			try {
				const state = await this.controller?.getStateToPostToWebview()
				if (state) {
					// Use direct send to ensure it's the first message
					this.socket.send(JSON.stringify({ type: "state", state }))
				}
			} catch (error) {
				Logger.error("[RemoteWebviewProvider] Failed to get initial state:", error)
			}

			// Flush queued messages
			Logger.info(`[RemoteWebviewProvider] Flushing ${this.messageQueue.length} queued messages`)
			while (this.messageQueue.length > 0) {
				const msg = this.messageQueue.shift()
				if (msg) this.postMessage(msg)
			}
		} else {
			Logger.info("[RemoteWebviewProvider] Socket disconnected")
		}
	}

	/**
	 * Handle incoming messages from the remote webapp
	 */
	handleRemoteMessage(message: WebviewMessage) {
		// This would be called by the RemoteServer when it receives a WS message
		// Bridge it to the controller just like VS Code does
		// The controller should have been set up in the base class constructor
		// But we need to make sure the controller knows how to handle these messages
		// (handleGrpcRequest, etc.)
		Logger.debug("[RemoteWebviewProvider] Received remote message:", (message as { command?: string }).command)
	}

	postMessage(message: ExtensionMessage): Thenable<boolean | undefined> {
		if (this.socket && this.socket.readyState === 1 /* OPEN */) {
			try {
				this.socket.send(JSON.stringify(message))
				return Promise.resolve(true)
			} catch (error) {
				Logger.error("[RemoteWebviewProvider] Failed to send message:", error)
				return Promise.resolve(false)
			}
		} else {
			Logger.warn("[RemoteWebviewProvider] Socket not connected, queuing message")
			this.messageQueue.push(message)
			return Promise.resolve(true)
		}
	}

	override getWebviewUrl(path: string): string {
		// For remote control, we might serve assets over HTTP
		// For now, return a placeholder or relative path
		return `/assets/${path}`
	}

	override getCspSource(): string {
		return "'self'"
	}

	override isVisible(): boolean {
		// Remote control is considered visible if a socket is connected
		return this.socket !== null && this.socket.readyState === 1
	}
}
