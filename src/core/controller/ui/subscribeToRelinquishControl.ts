import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<Empty>("relinquishControl")

export async function subscribeToRelinquishControl(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "relinquish_control_subscription" })
}

export async function sendRelinquishControlEvent(): Promise<void> {
	await hub.broadcast(Empty.create({}))
}
