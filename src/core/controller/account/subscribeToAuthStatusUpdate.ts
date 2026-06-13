import type { IController as Controller } from "@core/controller/types"
import { AuthService } from "@services/auth/AuthService"
import { AuthState, EmptyRequest } from "@/shared/proto/index.dietcode"
import { StreamingResponseHandler } from "../grpc-handler"

export async function subscribeToAuthStatusUpdate(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<AuthState>,
	requestId?: string,
): Promise<void> {
	return AuthService.getInstance().subscribeToAuthStatusUpdate(controller, request, responseStream, requestId)
}
