import { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/dietcode/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export const useApiConfigurationHandlers = () => {
	const { planActSeparateModelsSetting } = useExtensionState()

	const persistUpdates = async (updates: Partial<ApiConfiguration>) => {
		const protoConfig = convertApiConfigurationToProto(updates as ApiConfiguration)
		await ModelsServiceClient.updateApiConfigurationPartial(
			UpdateApiConfigurationPartialRequest.create({
				apiConfiguration: protoConfig,
				updateMask: Object.keys(updates),
			}),
		)
	}

	/**
	 * Updates a single field in the API configuration.
	 * Uses a field-masked partial update so delayed saves cannot overwrite unrelated
	 * fields (particularly the currently selected provider).
	 *
	 * @param field - The field key to update
	 * @param value - The new value for the field
	 */
	const handleFieldChange = async <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		await persistUpdates({ [field]: value } as Partial<ApiConfiguration>)
	}

	/**
	 * Updates multiple fields in the API configuration at once.
	 * All supplied fields are applied together as one field-masked operation.
	 *
	 * @param updates - An object containing the fields to update and their new values
	 */
	const handleFieldsChange = async (updates: Partial<ApiConfiguration>) => {
		await persistUpdates(updates)
	}

	const handleModeFieldChange = async <PlanK extends keyof ApiConfiguration, ActK extends keyof ApiConfiguration>(
		fieldPair: { plan: PlanK; act: ActK },
		value: ApiConfiguration[PlanK] & ApiConfiguration[ActK], // Intersection ensures value is compatible with both field types
		currentMode: Mode,
	) => {
		if (planActSeparateModelsSetting) {
			const targetField = fieldPair[currentMode]
			await handleFieldChange(targetField, value)
		} else {
			await handleFieldsChange({
				[fieldPair.plan]: value,
				[fieldPair.act]: value,
			})
		}
	}

	/**
	 * Updates multiple mode-specific fields in a single atomic operation.
	 *
	 * This prevents race conditions that can occur when making multiple separate
	 * handleModeFieldChange calls in rapid succession.
	 *
	 * @param fieldPairs - Object mapping keys to plan/act field pairs
	 * @param values - Object with values for each key
	 * @param currentMode - The current mode being targeted
	 */
	const handleModeFieldsChange = async <T extends Record<string, unknown>>(
		fieldPairs: { [K in keyof T]: { plan: keyof ApiConfiguration; act: keyof ApiConfiguration } },
		values: T,
		currentMode: Mode,
	) => {
		if (planActSeparateModelsSetting) {
			// Update only the current mode's fields
			const updates: Partial<ApiConfiguration> = {}
			Object.entries(fieldPairs).forEach(([key, { plan, act }]) => {
				const targetField = currentMode === "plan" ? plan : act
				updates[targetField] = values[key]
			})
			await handleFieldsChange(updates)
		} else {
			// Update both modes' fields
			const updates: Partial<ApiConfiguration> = {}
			Object.entries(fieldPairs).forEach(([key, { plan, act }]) => {
				updates[plan] = values[key]
				updates[act] = values[key]
			})
			await handleFieldsChange(updates)
		}
	}

	return { handleFieldChange, handleFieldsChange, handleModeFieldChange, handleModeFieldsChange }
}
