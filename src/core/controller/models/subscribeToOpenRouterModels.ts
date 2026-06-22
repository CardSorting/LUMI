import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/dietcode/models"
import { Logger } from "@/shared/services/Logger"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<OpenRouterCompatibleModelInfo>("openRouterModels")

/**
 * Subscribe to OpenRouter models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToOpenRouterModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "openRouterModels_subscription" })
}

/**
 * Send an OpenRouter models event to all active subscribers
 * @param models The OpenRouter models to send
 */
export async function sendOpenRouterModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	Logger.log("[DEBUG] sending OpenRouter models event")
	await hub.broadcast(models)
}
