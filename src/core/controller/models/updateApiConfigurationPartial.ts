import { buildApiHandler } from "@core/api"
import type { IController as Controller } from "@core/controller/types"
import { Empty } from "@shared/proto/dietcode/common"
import { ModelsApiConfiguration, UpdateApiConfigurationPartialRequest } from "@shared/proto/dietcode/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { ApiConfiguration, cerebrasModels } from "@/shared/api"
import { Logger } from "@/shared/services/Logger"

const CEREBRAS_API_KEY_FIELD = "cerebrasApiKey"

function validateUpdateMask(updateMask: string[]): void {
	const protoFields = ModelsApiConfiguration.create()
	for (const field of updateMask) {
		if (!Object.hasOwn(protoFields, field)) {
			throw new Error(`Invalid API configuration field in update_mask: ${field}`)
		}
	}
}

function normalizeAndValidateCerebrasApiKey(config: ApiConfiguration, updateMask: string[]): void {
	if (!updateMask.includes(CEREBRAS_API_KEY_FIELD) || config.cerebrasApiKey === undefined) {
		return
	}

	const normalizedKey = config.cerebrasApiKey.trim()
	if (/\s/.test(normalizedKey)) {
		throw new Error("Cerebras API key must not contain whitespace")
	}
	if (normalizedKey.length > 4_096) {
		throw new Error("Cerebras API key is too long")
	}
	config.cerebrasApiKey = normalizedKey
}

function validateCerebrasModelSelections(config: ApiConfiguration, updateMask: string[]): void {
	const selections = [
		{
			modelField: "planModeApiModelId",
			provider: config.planModeApiProvider,
			modelId: config.planModeApiModelId,
		},
		{
			modelField: "actModeApiModelId",
			provider: config.actModeApiProvider,
			modelId: config.actModeApiModelId,
		},
	] as const

	for (const selection of selections) {
		if (!updateMask.includes(selection.modelField) || selection.provider !== "cerebras" || !selection.modelId) {
			continue
		}
		if (!(selection.modelId in cerebrasModels)) {
			throw new Error(`Unsupported Cerebras model: ${selection.modelId}`)
		}
	}
}

function isCerebrasUpdate(config: ApiConfiguration, updateMask: string[]): boolean {
	if (updateMask.includes(CEREBRAS_API_KEY_FIELD)) {
		return true
	}

	return (
		(updateMask.includes("planModeApiProvider") && config.planModeApiProvider === "cerebras") ||
		(updateMask.includes("actModeApiProvider") && config.actModeApiProvider === "cerebras") ||
		(updateMask.includes("planModeApiModelId") && config.planModeApiProvider === "cerebras") ||
		(updateMask.includes("actModeApiModelId") && config.actModeApiProvider === "cerebras")
	)
}

/**
 * Updates API configuration with partial values using FieldMask
 *
 * Allows clients to update individual API configuration fields without
 * overwriting the entire configuration. Only fields specified in the update_mask
 * are updated from api_configuration.
 *
 * @param controller The controller instance
 * @param request The partial update API configuration request with FieldMask
 * @returns Empty response
 */
export async function updateApiConfigurationPartial(
	controller: Controller,
	request: UpdateApiConfigurationPartialRequest,
): Promise<Empty> {
	try {
		// Validate request
		if (!request.updateMask || request.updateMask.length === 0) {
			throw new Error("update_mask is required and must contain at least one field")
		}

		if (!request.apiConfiguration) {
			throw new Error("api_configuration is required")
		}
		validateUpdateMask(request.updateMask)

		// Get current config and convert new values from proto format
		const currentConfig = controller.stateManager.getApiConfiguration()
		const newConfigValues = convertProtoToApiConfiguration(request.apiConfiguration)
		normalizeAndValidateCerebrasApiKey(newConfigValues, request.updateMask)

		// Apply only the fields specified in the mask
		const updatedConfig = { ...currentConfig }
		for (const field of request.updateMask) {
			;(updatedConfig as Record<string, unknown>)[field] = (newConfigValues as Record<string, unknown>)[field]
		}
		validateCerebrasModelSelections(updatedConfig, request.updateMask)

		// Update storage and task API handler
		controller.stateManager.setApiConfiguration(updatedConfig)
		if (request.flushImmediately || isCerebrasUpdate(updatedConfig, request.updateMask)) {
			await controller.stateManager.flushPendingState()
		}
		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			controller.task.api = buildApiHandler({ ...updatedConfig, ulid: controller.task.ulid }, currentMode)
		}

		// Notify webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration (partial): ${error}`)
		throw error
	}
}
