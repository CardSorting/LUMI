import { IController } from "@core/controller/types"
import { Empty } from "@shared/proto/dietcode/common"
import { getRequestRegistry, StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { Logger } from "@/shared/services/Logger"

let joyZoningButtonClickedCallback: ((response: Empty) => void) | null = null

export async function subscribeToJoyZoningButtonClicked(
	_controller: IController,
	_request: any,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	joyZoningButtonClickedCallback = (response) => {
		responseStream(response).catch((error) => {
			Logger.warn("[JoyZoning] Failed to stream button click event:", error)
			joyZoningButtonClickedCallback = null
		})
	}

	if (requestId) {
		const registry = getRequestRegistry()
		const info = registry.getRequestInfo(requestId)
		if (info) {
			const originalCleanup = info.cleanup
			registry.registerRequest(
				requestId,
				() => {
					originalCleanup()
					joyZoningButtonClickedCallback = null
				},
				info.metadata,
				info.responseStream,
			)
		}
	}
}

export async function sendJoyZoningButtonClickedEvent() {
	if (joyZoningButtonClickedCallback) {
		joyZoningButtonClickedCallback(Empty.create({}))
	}
}
