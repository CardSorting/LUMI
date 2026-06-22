import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<Empty>("chatButtonClicked")

export async function subscribeToChatButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "chatButtonClicked_subscription" })
}

export async function sendChatButtonClickedEvent(): Promise<void> {
	await hub.broadcast(Empty.create({}))
}
