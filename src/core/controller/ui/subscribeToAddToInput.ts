import type { IController as Controller } from "@core/controller/types"
import type { EmptyRequest, String as ProtoString } from "@shared/proto/dietcode/common"
import { type StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<ProtoString>("addToInput")

/**
 * Subscribe to addToInput events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToAddToInput(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "addToInput_subscription" })
}

/**
 * Send an addToInput event to all active subscribers
 * @param text The text to add to the input
 */
export async function sendAddToInputEvent(text: string): Promise<void> {
	await hub.broadcast({ value: text })
}
