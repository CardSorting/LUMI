import { IController } from "@core/controller/types"
import { Empty } from "@shared/proto/dietcode/common"
import { StreamingResponseHandler } from "@/core/controller/grpc-handler"

let joyZoningButtonClickedCallback: ((response: Empty) => void) | null = null

export async function subscribeToJoyZoningButtonClicked(
	_controller: IController,
	_request: any,
	responseStream: StreamingResponseHandler<Empty>,
): Promise<void> {
	joyZoningButtonClickedCallback = (response) => {
		responseStream(response)
	}
}

export async function sendJoyZoningButtonClickedEvent() {
	if (joyZoningButtonClickedCallback) {
		joyZoningButtonClickedCallback(Empty.create({}))
	}
}
