import { qwenTokenPlanModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the QwenTokenPlanProvider component
 */
interface QwenTokenPlanProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Qwen Token Plan (Team Edition) provider configuration component.
 * Uses the compatible-mode OpenAI endpoint at:
 *   https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
 */
export const QwenTokenPlanProvider = ({ showModelOptions, isPopup, currentMode }: QwenTokenPlanProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.qwenTokenPlanApiKey || ""}
				onChange={(value) => handleFieldChange("qwenTokenPlanApiKey", value)}
				providerName="Qwen Token Plan (Team Edition)"
			/>

			<p
				style={{
					fontSize: "12px",
					marginTop: 4,
					marginBottom: 0,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Base URL:{" "}
				<code style={{ fontSize: "11px" }}>https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1</code>
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={qwenTokenPlanModels}
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

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						Enter any supported model ID directly, e.g. <code style={{ fontSize: "11px" }}>qwen3-7b-max</code> or{" "}
						<code style={{ fontSize: "11px" }}>Qwen3.8-Max-Preview</code>.
					</p>
				</>
			)}
		</div>
	)
}
