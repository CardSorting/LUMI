import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { ShowWebviewEvent } from "@shared/proto/dietcode/ui"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<ShowWebviewEvent>("showWebview")

/**
 * Subscribe to show webview events
 * @param controller The controller instance
 * @param request The show webview request containing preserveEditorFocus flag
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToShowWebview(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ShowWebviewEvent>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "show_webview_subscription" })
}

/**
 * Send a show webview event to all active subscribers
 * @param preserveEditorFocus When true, the webview should not steal focus from the editor
 */
export async function sendShowWebviewEvent(preserveEditorFocus = false): Promise<void> {
	await hub.broadcast(ShowWebviewEvent.create({ preserveEditorFocus }))
}
