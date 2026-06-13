import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/dietcode/models"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import { refreshLiteLlmModels } from "./refreshLiteLlmModels"

/**
 * Refreshes LiteLLM models and returns protobuf types for gRPC
 * @param controller The controller instance
 * @param request Empty request (unused but required for gRPC signature)
 * @returns OpenRouterCompatibleModelInfo with protobuf types
 */
export async function refreshLiteLlmModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await refreshLiteLlmModels()
	return OpenRouterCompatibleModelInfo.create({
		models: toProtobufModels(models),
	})
}
