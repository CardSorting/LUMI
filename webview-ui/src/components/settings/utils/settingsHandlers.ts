import { McpDisplayMode, UpdateSettingsRequest } from "@shared/proto/dietcode/state"
import { StateServiceClient } from "@/services/grpc-client"

/** Settings persisted via updateSettings but not yet on UpdateSettingsRequest proto */
export type ExtendedSettingsKey =
	| keyof UpdateSettingsRequest
	| "auditCompletionGateEnabled"
	| "auditCompletionGateThreshold"
	| "auditCompletionGateCriticalOnly"
	| "auditActModeAdvisoryEnabled"
	| "auditAdvisoryEscalationEnabled"
	| "auditPlanRegressionGateEnabled"
	| "auditToolOutputAdvisoryEnabled"
	| "auditFileWriteAdvisoryEnabled"
	| "auditIntentThresholdAdjustmentsEnabled"
	| "auditIntentThresholdOverrides"
	| "auditSarifHookExportEnabled"
	| "auditWorkspaceArtifactsEnabled"
	| "auditAdvisoryAutoScrollMode"

/**
 * Converts values to their corresponding proto format
 * @param field - The field name
 * @param value - The value to convert
 * @returns The converted value
 * @throws Error if the value is invalid for the field
 */
const convertToProtoValue = (field: ExtendedSettingsKey, value: any): any => {
	if (field === "mcpDisplayMode" && typeof value === "string") {
		switch (value) {
			case "rich":
				return McpDisplayMode.RICH
			case "plain":
				return McpDisplayMode.PLAIN
			case "markdown":
				return McpDisplayMode.MARKDOWN
			default:
				throw new Error(`Invalid MCP display mode value: ${value}`)
		}
	}
	return value
}

/**
 * Updates a single field in the settings.
 *
 * @param field - The field key to update
 * @param value - The new value for the field
 */
export const updateSetting = (field: ExtendedSettingsKey, value: any) => {
	const updateRequest: Record<string, unknown> = {
		[field]: convertToProtoValue(field, value),
	}

	StateServiceClient.updateSettings(UpdateSettingsRequest.create(updateRequest as Partial<UpdateSettingsRequest>)).catch(
		(error) => {
			console.error(`Failed to update setting ${field}:`, error)
		},
	)
}
