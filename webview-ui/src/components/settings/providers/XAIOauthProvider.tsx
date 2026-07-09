import { xaiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
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
	const { apiConfiguration, xaiOAuthIsAuthenticated } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const handleSignIn = async () => {
		try {
			await AccountServiceClient.xaiOauthSignIn({})
		} catch (error) {
			console.error("Failed to sign in to xAI:", error)
		}
	}

	const handleSignOut = async () => {
		try {
			await AccountServiceClient.xaiOauthSignOut({})
		} catch (error) {
			console.error("Failed to sign out of xAI:", error)
		}
	}

	return (
		<div>
			<div style={{ marginBottom: "15px" }}>
				{xaiOAuthIsAuthenticated ? (
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span style={{ color: "var(--vscode-descriptionForeground)" }}>Signed in to xAI Grok</span>
						<VSCodeButton appearance="secondary" onClick={handleSignOut}>
							Sign Out
						</VSCodeButton>
					</div>
				) : (
					<div>
						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "10px",
							}}>
							Sign in with your SuperGrok or X Premium+ subscription. A browser window will open for xAI's device
							authorization flow.
						</p>
						<VSCodeButton onClick={handleSignIn}>Sign in to xAI Grok</VSCodeButton>
					</div>
				)}
			</div>

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
