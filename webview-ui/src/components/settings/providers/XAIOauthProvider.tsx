import { xaiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface XAIOauthProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * xAI Grok (SuperGrok/X OAuth Subscription) provider configuration component.
 */
export const XAIOauthProvider = ({ showModelOptions, isPopup, currentMode }: XAIOauthProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<div style={{ marginBottom: "15px" }}>
				<p
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						marginBottom: "10px",
					}}>
					Uses xAI's Responses API. Automatically reads your SuperGrok / Premium+ OAuth token from your local Hermes
					configuration. You can also optionally enter your API key or token here.
				</p>
			</div>

			<ApiKeyField
				initialValue={apiConfiguration?.xaiApiKey || ""}
				onChange={(value) => handleFieldChange("xaiApiKey", value)}
				providerName="xAI OAuth Token"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={xaiModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
