import { EmptyRequest } from "@shared/proto/codemarie/common"
import { CodemarieRecommendedModel, CodemarieRecommendedModelsResponse } from "@shared/proto/codemarie/models"
import type { Controller } from "../index"
import { refreshCodemarieRecommendedModels } from "./refreshCodemarieRecommendedModels"

export async function refreshCodemarieRecommendedModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<CodemarieRecommendedModelsResponse> {
	const models = await refreshCodemarieRecommendedModels()
	return CodemarieRecommendedModelsResponse.create({
		recommended: models.recommended.map((model) =>
			CodemarieRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		free: models.free.map((model) =>
			CodemarieRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
	})
}
