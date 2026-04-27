/** biome-ignore-all lint/complexity/noThisInStatic: In static methods, this refers to the constructor (the subclass that invoked the method) when we want to refer to the subclass serviceName.
 *
 * NOTE: This file imports PLATFORM_CONFIG directly rather than using the PlatformProvider
 * because it contains static utility methods that are called from various contexts,
 * including non-React code. The configuration is compile-time constant, so direct
 * import is safe and ensures the methods work consistently regardless of React context.
 */
import { v4 as uuidv4 } from "uuid"
import { PLATFORM_CONFIG } from "../config/platform.config"

export interface Callbacks<TResponse> {
	onResponse: (response: TResponse) => void
	onError?: (error: Error) => void
	onComplete?: () => void
}

const DEFAULT_UNARY_TIMEOUT_MS = 60_000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 10 * 60_000

function toError(error: unknown, fallback: string): Error {
	if (error instanceof Error) {
		return error
	}
	return new Error(error ? String(error) : fallback)
}

/* biome-ignore lint/complexity/noStaticOnlyClass: ProtoBusClient is used as a namespace for gRPC methods */
export abstract class ProtoBusClient {
	static serviceName: string

	static async makeUnaryRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: Record<string, unknown>) => TResponse,
	): Promise<TResponse> {
		return new Promise((resolve, reject) => {
			const requestId = uuidv4()
			let settled = false
			let timeout: ReturnType<typeof setTimeout> | undefined

			const cleanup = () => {
				if (timeout) {
					clearTimeout(timeout)
					timeout = undefined
				}
				window.removeEventListener("message", handleResponse)
			}

			const fail = (error: unknown) => {
				if (settled) {
					return
				}
				settled = true
				cleanup()
				reject(toError(error, `gRPC request ${this.serviceName}.${methodName} failed`))
			}

			const succeed = (response: TResponse) => {
				if (settled) {
					return
				}
				settled = true
				cleanup()
				resolve(response)
			}

			// Set up one-time listener for this specific request
			const handleResponse = (event: MessageEvent) => {
				if (settled) {
					return
				}

				const message = event.data
				if (message.type === "host_action") {
					// Special handling for host actions like showing messages
					const { method, args } = message.host_action
					if (method === "showInformationMessage") {
						alert(`INFO: ${args[0]}`)
					} else if (method === "showWarningMessage") {
						alert(`WARNING: ${args[0]}`)
					} else if (method === "showErrorMessage") {
						alert(`ERROR: ${args[0]}`)
					}
					return
				}

				if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
					if (message.grpc_response.message) {
						try {
							const response = PLATFORM_CONFIG.decodeMessage(message.grpc_response.message, decodeResponse)
							succeed(response)
						} catch (error) {
							fail(toError(error, "Failed to decode unary response."))
						}
					} else if (message.grpc_response.error) {
						fail(new Error(message.grpc_response.error))
					} else {
						fail(new Error("Received ProtoBus response with no message or error."))
					}
				}
			}

			window.addEventListener("message", handleResponse)
			timeout = setTimeout(() => {
				fail(new Error(`Timed out waiting for ${this.serviceName}.${methodName} response.`))
			}, DEFAULT_UNARY_TIMEOUT_MS)

			try {
				const encodedMessage = PLATFORM_CONFIG.encodeMessage(request, encodeRequest)
				PLATFORM_CONFIG.postMessage({
					type: "grpc_request",
					grpc_request: {
						service: this.serviceName,
						method: methodName,
						message: encodedMessage,
						request_id: requestId,
						is_streaming: false,
					},
				})
			} catch (error) {
				fail(toError(error, `Failed to post ${this.serviceName}.${methodName} request.`))
			}
		})
	}

	static makeStreamingRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: Record<string, unknown>) => TResponse,
		callbacks: Callbacks<TResponse>,
	): () => void {
		const requestId = uuidv4()
		let closed = false
		let cancelSent = false
		let idleTimeout: ReturnType<typeof setTimeout> | undefined

		const cleanup = () => {
			if (idleTimeout) {
				clearTimeout(idleTimeout)
				idleTimeout = undefined
			}
			window.removeEventListener("message", handleResponse)
		}

		const close = (options: { notifyComplete?: boolean; error?: Error; sendCancel?: boolean } = {}) => {
			if (closed) {
				return
			}
			closed = true
			cleanup()

			if (options.error) {
				try {
					callbacks.onError?.(options.error)
				} catch (callbackError) {
					console.error("Streaming onError callback failed:", callbackError)
				}
			} else if (options.notifyComplete) {
				try {
					callbacks.onComplete?.()
				} catch (callbackError) {
					console.error("Streaming onComplete callback failed:", callbackError)
				}
			}

			if (options.sendCancel && !cancelSent) {
				cancelSent = true
				try {
					PLATFORM_CONFIG.postMessage({
						type: "grpc_request_cancel",
						grpc_request_cancel: {
							request_id: requestId,
						},
					})
				} catch (error) {
					console.error(`Failed to send cancellation for request ${requestId}:`, error)
				}
			}
		}

		const resetIdleTimeout = () => {
			if (closed) {
				return
			}
			if (idleTimeout) {
				clearTimeout(idleTimeout)
			}
			idleTimeout = setTimeout(() => {
				close({
					error: new Error(`Timed out waiting for ${this.serviceName}.${methodName} stream update.`),
					sendCancel: true,
				})
			}, DEFAULT_STREAM_IDLE_TIMEOUT_MS)
		}

		// Set up listener for streaming responses
		const handleResponse = (event: MessageEvent) => {
			if (closed) {
				return
			}

			const message = event.data

			if (message.type === "host_action") {
				// Special handling for host actions like showing messages
				const { method, args } = message.host_action
				if (method === "showInformationMessage") {
					alert(`INFO: ${args[0]}`)
				} else if (method === "showWarningMessage") {
					alert(`WARNING: ${args[0]}`)
				} else if (method === "showErrorMessage") {
					alert(`ERROR: ${args[0]}`)
				}
				return
			}

			if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
				resetIdleTimeout()

				if (message.grpc_response.message) {
					// Process streaming message
					try {
						const response = PLATFORM_CONFIG.decodeMessage(message.grpc_response.message, decodeResponse)
						callbacks.onResponse(response)
					} catch (error) {
						close({ error: toError(error, "Failed to decode streaming response."), sendCancel: true })
						return
					}
				} else if (message.grpc_response.error) {
					close({ error: new Error(message.grpc_response.error) })
					return
				} else if (message.grpc_response.is_streaming === false) {
					// Terminal message with no message/error is a clean completion
					close({ notifyComplete: true })
					return
				} else {
					close({
						error: new Error("Received ProtoBus stream response with no message or error."),
						sendCancel: true,
					})
					return
				}

				if (message.grpc_response.is_streaming === false) {
					close({ notifyComplete: true })
				}
			}
		}

		window.addEventListener("message", handleResponse)
		resetIdleTimeout()

		try {
			const encodedMessage = PLATFORM_CONFIG.encodeMessage(request, encodeRequest)
			PLATFORM_CONFIG.postMessage({
				type: "grpc_request",
				grpc_request: {
					service: this.serviceName,
					method: methodName,
					message: encodedMessage,
					request_id: requestId,
					is_streaming: true,
				},
			})
		} catch (error) {
			close({ error: toError(error, `Failed to start ${this.serviceName}.${methodName} stream.`) })
		}

		// Return a function to cancel the stream
		return () => {
			close({ sendCancel: true })
		}
	}
}
