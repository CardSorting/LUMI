import { internationalZAiModels, mainlandZAiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the ZAiProvider component
 */
interface ZAiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Z AI provider configuration component
 */
export const ZAiProvider = ({ showModelOptions, isPopup, currentMode }: ZAiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Determine which models to use based on API line selection
	const zaiModels = useMemo(
		() => (apiConfiguration?.zaiApiLine === "china" ? mainlandZAiModels : internationalZAiModels),
		[apiConfiguration?.zaiApiLine],
	)

	return (
		<div className="flex flex-col gap-2">
			<div
				style={{
					background: "var(--vscode-editor-inactiveSelectionBackground)",
					border: "1px solid var(--vscode-textLink-foreground)",
					borderRadius: "6px",
					padding: "8px 12px",
					marginBottom: "12px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "12px",
					position: "relative",
					overflow: "hidden",
				}}>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "2px",
					}}>
					<div
						style={{
							fontWeight: "bold",
							fontSize: "12px",
							color: "var(--vscode-textLink-foreground)",
							display: "flex",
							alignItems: "center",
							gap: "4px",
						}}>
						<span>🚀</span>
						<span>GLM Coding Plan Special</span>
					</div>
					<div style={{ fontSize: "11px", opacity: 0.9, lineHeight: "1.2" }}>
						Elite GLM-5 models starting at <b>$18/month</b>.
					</div>
				</div>
				<a
					href="https://z.ai/subscribe?ic=3LBVSDNHAW"
					rel="noopener noreferrer"
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "4px 10px",
						backgroundColor: "var(--vscode-button-background)",
						color: "var(--vscode-button-foreground)",
						textDecoration: "none",
						borderRadius: "3px",
						fontSize: "11px",
						fontWeight: "600",
						whiteSpace: "nowrap",
					}}
					target="_blank">
					Claim Offer
				</a>
			</div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="zai-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Z AI Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="zai-entrypoint"
					onChange={(e) => handleFieldChange("zaiApiLine", (e.target as HTMLSelectElement).value)}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.zaiApiLine || "international"}>
					<VSCodeOption value="international">api.z.ai</VSCodeOption>
					<VSCodeOption value="coding">api.z.ai (Coding)</VSCodeOption>
					<VSCodeOption value="china">open.bigmodel.cn</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Please select the appropriate API entrypoint based on your location. If you are in China, choose open.bigmodel.cn
				. Otherwise, choose api.z.ai.
			</p>
			<ApiKeyField
				initialValue={apiConfiguration?.zaiApiKey || ""}
				onChange={(value) => handleFieldChange("zaiApiKey", value)}
				providerName="Z AI"
				signupUrl={
					apiConfiguration?.zaiApiLine === "china"
						? "https://open.bigmodel.cn/console/overview"
						: "https://z.ai/manage-apikey/apikey-list"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={zaiModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								(e.target as HTMLSelectElement).value,
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
