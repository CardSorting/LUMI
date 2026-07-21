import { codingZAiModels, internationalZAiModels, mainlandZAiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ZAiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const ZAiProvider = ({ showModelOptions, isPopup, currentMode }: ZAiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const apiLine = apiConfiguration?.zaiApiLine || "international"
	const [isCustomModel, setIsCustomModel] = useState<boolean>(
		() =>
			!!selectedModelId &&
			!(selectedModelId in internationalZAiModels) &&
			!(selectedModelId in mainlandZAiModels) &&
			!(selectedModelId in codingZAiModels),
	)
	const [customModelId, setCustomModelId] = useState<string>(isCustomModel ? selectedModelId || "" : "")

	const activeModels = apiLine === "coding" ? codingZAiModels : apiLine === "china" ? mainlandZAiModels : internationalZAiModels

	const handleModelSelect = (val: string) => {
		if (val === "custom") {
			setIsCustomModel(true)
			if (customModelId) {
				handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, customModelId, currentMode)
			}
		} else {
			setIsCustomModel(false)
			handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, val, currentMode)
		}
	}

	const handleCustomModelChange = (val: string) => {
		setCustomModelId(val)
		handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, val, currentMode)
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<label htmlFor="zai-api-line">
					<span style={{ fontWeight: 500 }}>API Endpoint / Line</span>
				</label>
				<VSCodeDropdown
					id="zai-api-line"
					onChange={(e) => handleFieldChange("zaiApiLine", (e.target as HTMLSelectElement).value)}
					style={{ width: "100%" }}
					value={apiLine}>
					<VSCodeOption value="international">International (https://api.z.ai/api/paas/v4)</VSCodeOption>
					<VSCodeOption value="coding">GLM Coding Plan (https://api.z.ai/api/coding/paas/v4)</VSCodeOption>
					<VSCodeOption value="china">Mainland China (https://open.bigmodel.cn/api/paas/v4)</VSCodeOption>
				</VSCodeDropdown>
			</div>

			<ApiKeyField
				initialValue={apiConfiguration?.zaiApiKey || ""}
				onChange={(value) => handleFieldChange("zaiApiKey", value)}
				providerName="Z.AI"
				signupUrl="https://z.ai/"
			/>

			<div
				style={{
					fontSize: "12px",
					padding: "8px 10px",
					borderRadius: "4px",
					backgroundColor: "var(--vscode-badge-background)",
					color: "var(--vscode-badge-foreground)",
					display: "flex",
					flexDirection: "column",
					gap: "3px",
				}}>
				<span>🚀 You’ve been invited to join the GLM Coding Plan!</span>
				<a
					href="https://z.ai/subscribe?ic=3LBVSDNHAW"
					rel="noreferrer"
					style={{
						color: "inherit",
						fontWeight: 600,
						textDecoration: "underline",
					}}
					target="_blank">
					👉 Join now: https://z.ai/subscribe?ic=3LBVSDNHAW
				</a>
			</div>

			{showModelOptions && (
				<>
					<div className="flex flex-col gap-1">
						<label htmlFor="zai-model-select">
							<span style={{ fontWeight: 500 }}>Model</span>
						</label>
						<VSCodeDropdown
							id="zai-model-select"
							onChange={(e) => handleModelSelect((e.target as HTMLSelectElement).value)}
							style={{ width: "100%" }}
							value={isCustomModel ? "custom" : selectedModelId || "glm-5.2"}>
							{Object.keys(activeModels).map((mId) => (
								<VSCodeOption key={mId} value={mId}>
									{mId}
								</VSCodeOption>
							))}
							<VSCodeOption value="custom">Use custom model...</VSCodeOption>
						</VSCodeDropdown>
					</div>

					{isCustomModel && (
						<div className="flex flex-col gap-1">
							<label htmlFor="zai-custom-model-id">
								<span style={{ fontWeight: 500 }}>Custom Model Code</span>
							</label>
							<VSCodeTextField
								id="zai-custom-model-id"
								onInput={(e) => handleCustomModelChange((e.target as HTMLInputElement).value)}
								placeholder="e.g. glm-5.2"
								style={{ width: "100%" }}
								value={customModelId}
							/>
						</div>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId || ""} />
				</>
			)}
		</div>
	)
}
