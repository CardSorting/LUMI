/**
 * RemoteWebviewProvider implementation for remote control.
 * Bridges communication between the Controller and a WebSocket client.
 */
import type { WebSocket } from "ws"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import type { DietCodeExtensionContext } from "@/shared/dietcode"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import type { WebviewMessage } from "@/shared/WebviewMessage"
import { WebviewProvider } from "./WebviewProvider"

export class RemoteWebviewProvider extends WebviewProvider {
	private socket: WebSocket | null = null
	private messageQueue: ExtensionMessage[] = []

	constructor(context: DietCodeExtensionContext) {
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
	async handleRemoteMessage(message: WebviewMessage): Promise<void> {
		const postMessageToWebview = (response: ExtensionMessage) => this.postMessage(response)

		switch (message.type) {
			case "grpc_request": {
				await handleGrpcRequest(this.controller, postMessageToWebview, message.grpc_request)
				break
			}
			case "grpc_request_cancel": {
				await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
				break
			}
			case "execute_command": {
				Logger.warn("[RemoteWebviewProvider] Rejected remote execute_command message:", message.execute_command.command)
				await HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Remote webview command execution is not available.",
				})
				break
			}
			default: {
				Logger.error("[RemoteWebviewProvider] Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
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
