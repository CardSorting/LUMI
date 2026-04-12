import { EmptyRequest } from "@shared/proto/dietcode/common"
import { DietCodeRecommendedModel, DietCodeRecommendedModelsResponse } from "@shared/proto/dietcode/models"
import type { Controller } from "../index"
import { refreshDietCodeRecommendedModels } from "./refreshDietCodeRecommendedModels"

export async function refreshDietCodeRecommendedModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<DietCodeRecommendedModelsResponse> {
	const models = await refreshDietCodeRecommendedModels()
	return DietCodeRecommendedModelsResponse.create({
		recommended: models.recommended.map((model) =>
			DietCodeRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		free: models.free.map((model) =>
			DietCodeRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
	})
}
