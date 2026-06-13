import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/dietcode/models"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import { refreshVercelAiGatewayModels } from "./refreshVercelAiGatewayModels"

/**
 * Handles protobuf conversion for gRPC service
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing Vercel AI Gateway models (protobuf types)
 */
export async function refreshVercelAiGatewayModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await refreshVercelAiGatewayModels(controller)
	return OpenRouterCompatibleModelInfo.create({ models: toProtobufModels(models) })
}
