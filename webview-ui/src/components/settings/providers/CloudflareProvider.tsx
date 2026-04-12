import { cloudflareModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CloudflareProvider component
 */
interface CloudflareProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Cloudflare provider configuration component
 */
export const CloudflareProvider = ({ showModelOptions, isPopup, currentMode }: CloudflareProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<label htmlFor="cloudflare-account-id">
					<span style={{ fontWeight: 500 }}>Cloudflare Account ID</span>
				</label>
				<VSCodeTextField
					id="cloudflare-account-id"
					onInput={(e) => handleFieldChange("cloudflareAccountId", (e.target as any).value)}
					placeholder="Enter your Cloudflare Account ID"
					style={{ width: "100%" }}
					value={apiConfiguration?.cloudflareAccountId || ""}
				/>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					Your Account ID can be found in the Cloudflare dashboard URL (e.g., dash.cloudflare.com/{"<your-id>"}).
				</p>
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor="cloudflare-api-token">
					<span style={{ fontWeight: 500 }}>Cloudflare API Token</span>
				</label>
				<VSCodeTextField
					id="cloudflare-api-token"
					onInput={(e) => handleFieldChange("cloudflareApiToken", (e.target as any).value)}
					placeholder="Enter your Cloudflare API Token"
					style={{ width: "100%" }}
					type="password"
					value={apiConfiguration?.cloudflareApiToken || ""}
				/>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					Create a token with Workers AI read/write permissions at{" "}
					<a href="https://dash.cloudflare.com/profile/api-tokens">dash.cloudflare.com/profile/api-tokens</a>.
				</p>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={cloudflareModels}
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
