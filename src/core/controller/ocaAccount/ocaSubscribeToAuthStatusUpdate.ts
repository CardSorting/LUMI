import { EmptyRequest } from "@shared/proto/codemarie/common"
import { OcaAuthState } from "@shared/proto/codemarie/oca_account"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function ocaSubscribeToAuthStatusUpdate(
	_controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<OcaAuthState>,
	requestId?: string,
): Promise<void> {
	return OcaAuthService.getInstance().subscribeToAuthStatusUpdate(request, responseStream, requestId)
}
