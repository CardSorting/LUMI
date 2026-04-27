import { Controller } from "@core/controller/index"
import { serviceHandlers } from "@generated/hosts/vscode/protobus-services"
import { GrpcRecorderBuilder } from "@/core/controller/grpc-recorder/grpc-recorder.builder"
import { GrpcRequestRegistry } from "@/core/controller/grpc-request-registry"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { GrpcCancel, GrpcRequest } from "@/shared/WebviewMessage"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler<TResponse> = (
	response: TResponse,
	isLast?: boolean,
	sequenceNumber?: number,
) => Promise<void>

export type PostMessageToWebview = (message: ExtensionMessage) => Thenable<boolean | undefined>

/**
 * Creates a middleware wrapper for recording gRPC requests and responses
 */
function withRecordingMiddleware(postMessage: PostMessageToWebview, controller: Controller): PostMessageToWebview {
	return async (response: ExtensionMessage) => {
		if (response?.grpc_response) {
			try {
				GrpcRecorderBuilder.getRecorder(controller).recordResponse(
					response.grpc_response.request_id,
					response.grpc_response,
				)
			} catch (e) {
				Logger.warn("Failed to record gRPC response:", e)
			}
		}
		return postMessage(response)
	}
}

/**
 * Records gRPC request with error handling
 */
function recordRequest(request: GrpcRequest, controller: Controller): void {
	try {
		GrpcRecorderBuilder.getRecorder(controller).recordRequest(request)
	} catch (e) {
		Logger.warn("Failed to record gRPC request:", e)
	}
}

/**
 * Handles a gRPC request from the webview.
 */
export async function handleGrpcRequest(
	controller: Controller,
	postMessageToWebview: PostMessageToWebview,
	request: GrpcRequest,
): Promise<void> {
	recordRequest(request, controller)

	// Create recording middleware wrapper
	const postMessageWithRecording = withRecordingMiddleware(postMessageToWebview, controller)

	if (request.is_streaming) {
		await handleStreamingRequest(controller, postMessageWithRecording, request)
	} else {
		await handleUnaryRequest(controller, postMessageWithRecording, request)
	}
}

/**
 * Handles a gRPC unary request from the webview.
 *
 * Calls the handler using the service and method name, and then posts the result back to the webview.
 */
async function handleUnaryRequest(
	controller: Controller,
	postMessageToWebview: PostMessageToWebview,
	request: GrpcRequest,
): Promise<void> {
	try {
		// Get the service handler from the config
		const handler = getHandler(request.service, request.method)
		// Handle unary request
		const response = await handler(controller, request.message)
		// Send response to the webview
		await postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				message: response,
				request_id: request.request_id,
			},
		})
	} catch (error) {
		// Send error response
		Logger.log("Protobus error:", error)
		await postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	}
}

/**
 * Handle a streaming gRPC request from the webview.
 *
 * Calls the handler using the service and method name, and creates a streaming response handler
 * which posts results back to the webview.
 */
async function handleStreamingRequest(
	controller: Controller,
	postMessageToWebview: PostMessageToWebview,
	request: GrpcRequest,
): Promise<void> {
	let isTerminated = false

	// Create a response stream function with terminal guard
	const responseStream: StreamingResponseHandler<any> = async (response: any, isLast = false, sequenceNumber?: number) => {
		if (isTerminated) {
			return
		}

		if (isLast) {
			isTerminated = true
		}

		await postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				message: response,
				request_id: request.request_id,
				is_streaming: !isLast,
				sequence_number: sequenceNumber,
			},
		})

		if (isLast) {
			requestRegistry.cancelRequest(request.request_id)
		}
	}

	try {
		// Register the request for cancellation support
		requestRegistry.registerRequest(
			request.request_id,
			() => {
				isTerminated = true
			},
			{ service: request.service, method: request.method },
			responseStream,
		)

		// Get the service handler from the config
		const handler = getHandler(request.service, request.method)

		// Handle streaming request and pass the requestId to all streaming handlers
		await handler(controller, request.message, responseStream, request.request_id)

		// If the handler completes without calling responseStream with isLast=true,
		// we should still ensure the request is cleaned up eventually.
		// However, many streams are persistent (like button subscriptions).
	} catch (error) {
		if (isTerminated) {
			return
		}
		isTerminated = true

		// Send error response
		Logger.log("Protobus error:", error)
		await postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: request.request_id,
				is_streaming: false,
			},
		})

		requestRegistry.cancelRequest(request.request_id)
	}
}

/**
 * Handles a gRPC request cancellation from the webview.
 * @param controller The controller instance
 * @param request The cancellation request
 */
export async function handleGrpcRequestCancel(postMessageToWebview: PostMessageToWebview, request: GrpcCancel) {
	const cancelled = requestRegistry.cancelRequest(request.request_id)

	if (cancelled) {
		// Send a cancellation confirmation
		await postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				message: { cancelled: true },
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	} else {
		Logger.log(`[DEBUG] Request not found for cancellation: ${request.request_id}`)
	}
}

// Registry to track active gRPC requests and their cleanup functions
const requestRegistry = new GrpcRequestRegistry()

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}

function getHandler(serviceName: string, methodName: string): any {
	// Get the service handler from the config
	const serviceConfig = serviceHandlers[serviceName]
	if (!serviceConfig) {
		throw new Error(`Unknown service: ${serviceName}`)
	}
	const handler = serviceConfig[methodName]
	if (!handler) {
		throw new Error(`Unknown rpc: ${serviceName}.${methodName}`)
	}
	return handler
}
