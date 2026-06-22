import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { DietCodeMessage } from "@shared/proto/dietcode/ui"
import { Logger } from "@/shared/services/Logger"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<DietCodeMessage>("partialMessage")

// Callback-based subscriptions (CLI and other non-gRPC consumers)
export type PartialMessageCallback = (message: DietCodeMessage) => void
const callbackSubscriptions = new Set<PartialMessageCallback>()

/**
 * Subscribe to partial message events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToPartialMessage(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<DietCodeMessage>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "partial_message_subscription" })
}

/**
 * Register a callback to receive partial message events (for CLI and non-gRPC consumers)
 * @param callback The callback function to receive messages
 * @returns A function to unsubscribe
 */
export function registerPartialMessageCallback(callback: PartialMessageCallback): () => void {
	callbackSubscriptions.add(callback)
	return () => {
		callbackSubscriptions.delete(callback)
	}
}

/**
 * Send a partial message event to all active subscribers
 * @param partialMessage The DietCodeMessage to send
 */
export async function sendPartialMessageEvent(partialMessage: DietCodeMessage): Promise<void> {
	await hub.broadcast(partialMessage)

	for (const callback of callbackSubscriptions) {
		try {
			callback(partialMessage)
		} catch (error) {
			Logger.error("Error in partial message callback:", error)
		}
	}
}
