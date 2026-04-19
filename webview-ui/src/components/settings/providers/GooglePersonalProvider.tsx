import { geminiModels } from "@shared/api"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { normalizeApiConfiguration, supportsReasoningEffortForModelId } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the GooglePersonalProvider component
 */
interface GooglePersonalProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Google (Personal) provider configuration component
 */
export const GooglePersonalProvider = ({ showModelOptions, isPopup, currentMode }: GooglePersonalProviderProps) => {
	const { apiConfiguration, googleAuthIsAuthenticated, googleUserInfo } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const [isLoading, setIsLoading] = useState(false)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId)

	const handleLogin = () => {
		setIsLoading(true)
		AccountServiceClient.googleAuthClicked(EmptyRequest.create())
			.catch((err: any) => console.error("Failed to trigger Google login:", err))
			.finally(() => {
				setIsLoading(false)
			})
	}

	const handleSignOut = () => {
		setIsLoading(true)
		AccountServiceClient.googleSignOutClicked(EmptyRequest.create())
			.catch((err: any) => console.error("Failed to sign out from Google:", err))
			.finally(() => {
				setIsLoading(false)
			})
	}

	return (
		<div className="google-personal-provider">
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				{googleAuthIsAuthenticated ? (
					<div
						style={{
							padding: "12px",
							background: "var(--vscode-notifications-infoBackground)",
							color: "var(--vscode-notifications-infoForeground)",
							borderRadius: "8px",
							border: "1px solid var(--vscode-notifications-border)",
							boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
						}}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								marginBottom: 8,
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
								<div
									style={{
										width: "24px",
										height: "24px",
										borderRadius: "50%",
										background: "#4285F4",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										color: "white",
										fontSize: "12px",
										fontWeight: "bold",
									}}>
									{googleUserInfo?.email?.charAt(0).toUpperCase() || "G"}
								</div>
								<div style={{ display: "flex", flexDirection: "column" }}>
									<span style={{ fontSize: "12px", fontWeight: "600", opacity: 0.9 }}>
										{googleUserInfo?.displayName || "Google Account"}
									</span>
									<span style={{ fontSize: "11px", opacity: 0.7 }}>{googleUserInfo?.email}</span>
								</div>
							</div>
							<VscIcon name="pass-filled" style={{ color: "#34A853", fontSize: "18px" }} />
						</div>

						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								marginTop: 12,
								paddingTop: 8,
								borderTop: "1px solid var(--vscode-notifications-border)",
							}}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									fontSize: "10px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								<VscIcon name="info" style={{ marginRight: 4 }} />
								Free Tier (60 RPM / 1000 RPD)
							</div>
							<a
								href="#"
								onClick={(e) => {
									e.preventDefault()
									handleSignOut()
								}}
								style={{
									fontSize: "11px",
									color: "var(--vscode-textLink-foreground)",
									textDecoration: "none",
									cursor: isLoading ? "not-allowed" : "pointer",
									opacity: isLoading ? 0.5 : 1,
								}}>
								Sign Out
							</a>
						</div>
					</div>
				) : (
					<div
						style={{
							marginTop: 10,
							marginBottom: 10,
							display: "flex",
							flexDirection: "column",
							gap: "12px",
						}}>
						<VSCodeButton
							disabled={isLoading}
							onClick={handleLogin}
							style={{
								width: "100%",
								background: "#4285F4",
								color: "white",
								border: "none",
								height: "32px",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<svg height="18" viewBox="0 0 18 18" width="18">
									<path
										d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
										fill="#ffffff"
									/>
									<path
										d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
										fill="#ffffff"
									/>
									<path
										d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
										fill="#ffffff"
									/>
									<path
										d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.483 0 2.443 2.017.957 4.963L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
										fill="#ffffff"
									/>
								</svg>
								Sign In with Google
								{isLoading && (
									<span className="ml-1 animate-spin">
										<VscIcon name="refresh" />
									</span>
								)}
							</div>
						</VSCodeButton>
						<div
							style={{
								padding: "10px",
								borderRadius: "6px",
								background: "rgba(66, 133, 244, 0.05)",
								border: "1px dashed rgba(66, 133, 244, 0.3)",
							}}>
							<p style={{ fontSize: "11px", opacity: 0.8, margin: 0, lineHeight: "1.4" }}>
								🎯 <strong>Free tier enabled</strong>: 60 requests/min and 1,000 requests/day with your personal
								Google account.
							</p>
						</div>
					</div>
				)}
			</div>

			{showModelOptions && googleAuthIsAuthenticated && (
				<div style={{ marginTop: 16 }}>
					<ModelSelector
						label="Model"
						models={geminiModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</div>
			)}
		</div>
	)
}
