import { BooleanRequest, EmptyRequest } from "@shared/proto/dietcode/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import DietCodeLogoWhite from "@/assets/DietCodeLogoWhite"
import { LumiAmbientOrb } from "@/components/common/LumiAmbientOrb"
import { LumiProgressIndicator } from "@/components/common/LumiProgressIndicator"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { resolveOrbMood, useLumiSessionComfort } from "@/hooks/useLumiSessionComfort"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const WelcomeView = memo(() => {
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [showApiOptions, setShowApiOptions] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const { isStill, calmTier } = useLumiSessionComfort()

	const disableLetsGoButton = apiErrorMessage != null

	const handleLogin = () => {
		setIsLoading(true)
		AccountServiceClient.accountLoginClicked(EmptyRequest.create())
			.catch((err) => console.error("Failed to get login URL:", err))
			.finally(() => {
				setIsLoading(false)
			})
	}

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col items-center justify-center bg-background">
			<div className="max-w-[420px] w-[90%] glass-panel p-10 rounded-3xl flex flex-col gap-8 shadow-2xl animate-fade-slide-in">
				<div className="flex flex-col items-center gap-3">
					<h2 className="text-2xl font-semibold tracking-tight">Hi, I'm LUMI</h2>
					<p className="text-description text-center mb-1">Your calm coding companion.</p>
					<LumiAmbientOrb calmTier={calmTier} mood={resolveOrbMood("idle", isStill)}>
						<DietCodeLogoWhite className="size-20 drop-shadow-lg" />
					</LumiAmbientOrb>
				</div>
				<p className="leading-relaxed text-center">
					Ask me something about your code. I'll help you explore, edit, and understand your project — nothing changes
					unless you say it's okay.
				</p>

				<p className="text-(--vscode-descriptionForeground) leading-relaxed text-center text-sm">
					Sign up free to start, or bring your own API key.
				</p>

				<VSCodeButton className="btn-premium-lumi h-12 w-full mt-1 rounded-xl" disabled={isLoading} onClick={handleLogin}>
					<span className="text-base">Get started</span>
					{isLoading && <LumiProgressIndicator />}
				</VSCodeButton>

				{!showApiOptions && (
					<VSCodeButton
						appearance="secondary"
						className="mt-1 w-full rounded-xl"
						onClick={() => setShowApiOptions(!showApiOptions)}>
						Use your own API key
					</VSCodeButton>
				)}

				<div className="mt-2">
					{showApiOptions && (
						<div>
							<ApiOptions currentMode={mode} showModelOptions={false} />
							<VSCodeButton className="mt-0.75 rounded-xl" disabled={disableLetsGoButton} onClick={handleSubmit}>
								Let's go!
							</VSCodeButton>
						</div>
					)}
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
