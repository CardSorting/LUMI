import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/dietcode/models"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<OpenRouterCompatibleModelInfo>("liteLlmModels")

/**
 * Subscribe to LiteLLM models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToLiteLlmModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "liteLlmModels_subscription" })
}

/**
 * Send a LiteLLM models event to all active subscribers
 * @param models The LiteLLM models to send
 */
export async function sendLiteLlmModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	await hub.broadcast(models)
}
