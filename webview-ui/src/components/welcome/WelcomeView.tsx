import { ApiProvider } from "@shared/api"
import { BooleanRequest } from "@shared/proto/dietcode/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ChangeEvent, memo, useEffect, useState } from "react"
import DietCodeLogoWhite from "@/assets/DietCodeLogoWhite"
import { LumiAmbientOrb } from "@/components/common/LumiAmbientOrb"
import { LumiProgressIndicator } from "@/components/common/LumiProgressIndicator"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { resolveOrbMood, useLumiSessionComfort } from "@/hooks/useLumiSessionComfort"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"

const WelcomeView = memo(() => {
	const { apiConfiguration, mode, openAiCodexIsAuthenticated } = useExtensionState()
	const [isLoading, setIsLoading] = useState(false)
	const [isSaving, setIsSaving] = useState(false)
	const { isStill, calmTier } = useLumiSessionComfort()
	const { handleModeFieldChange, handleFieldChange } = useApiConfigurationHandlers()

	// Onboarding state
	const [selectedMethod, setSelectedMethod] = useState<"codex" | "nous" | null>(null)
	const [nousKey, setNousKey] = useState(apiConfiguration?.nousResearchApiKey || "")
	const [showKey, setShowKey] = useState(false)
	const [isWaitingForCallback, setIsWaitingForCallback] = useState(false)

	// Initialize selectedMethod based on existing state
	useEffect(() => {
		if (openAiCodexIsAuthenticated) {
			setSelectedMethod("codex")
			setIsWaitingForCallback(false)
		} else if (apiConfiguration?.nousResearchApiKey) {
			setSelectedMethod("nous")
			setNousKey(apiConfiguration.nousResearchApiKey)
		}
	}, [openAiCodexIsAuthenticated, apiConfiguration?.nousResearchApiKey])

	const handleCodexSignIn = async () => {
		setIsLoading(true)
		setIsWaitingForCallback(true)
		try {
			await AccountServiceClient.openAiCodexSignIn({})
		} catch (error) {
			console.error("Failed to sign in to OpenAI Codex:", error)
			setIsWaitingForCallback(false)
		} finally {
			setIsLoading(false)
		}
	}

	const handleCodexSignOut = async () => {
		try {
			await AccountServiceClient.openAiCodexSignOut({})
		} catch (error) {
			console.error("Failed to sign out of OpenAI Codex:", error)
		}
	}

	const handleNousKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
		const val = event.target.value
		setNousKey(val)
		handleFieldChange("nousResearchApiKey", val)
	}

	const handleProceed = async () => {
		setIsSaving(true)
		try {
			if (selectedMethod === "codex" && openAiCodexIsAuthenticated) {
				await handleModeFieldChange(
					{ plan: "planModeApiProvider", act: "actModeApiProvider" },
					"openai-codex" as ApiProvider,
					mode,
					{ flushImmediately: true },
				)
			} else if (selectedMethod === "nous" && nousKey.trim()) {
				await handleFieldChange("nousResearchApiKey", nousKey.trim(), { flushImmediately: true })
				await handleModeFieldChange(
					{ plan: "planModeApiProvider", act: "actModeApiProvider" },
					"nousResearch" as ApiProvider,
					mode,
					{ flushImmediately: true },
				)
			}
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to complete welcome view:", error)
		} finally {
			setIsSaving(false)
		}
	}

	const handleSkip = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to skip welcome view:", error)
		}
	}

	const isProceedEnabled =
		(selectedMethod === "codex" && openAiCodexIsAuthenticated) || (selectedMethod === "nous" && nousKey.trim().length > 0)

	return (
		<div className="fixed inset-0 p-0 flex flex-col items-center justify-center bg-background overflow-y-auto">
			<div className="max-w-[420px] w-[90%] my-8 glass-panel p-8 rounded-3xl flex flex-col gap-6 shadow-2xl animate-fade-slide-in">
				<div className="flex flex-col items-center gap-3">
					<h2 className="text-2xl font-bold tracking-tight text-foreground">Hi, I'm LUMI</h2>
					<p className="text-description text-center text-sm m-0">Your calm coding companion.</p>
					<LumiAmbientOrb calmTier={calmTier} mood={resolveOrbMood("idle", isStill)}>
						<DietCodeLogoWhite className="size-20 drop-shadow-lg" />
					</LumiAmbientOrb>
				</div>

				<p className="text-sm leading-relaxed text-center text-foreground m-0">
					Ask me something about your code. I'll help you explore, edit, and understand your project — nothing changes
					unless you say it's okay.
				</p>

				<div className="flex flex-col gap-3 mt-2">
					<p className="text-xs text-description text-center font-semibold tracking-wider uppercase m-0">
						Choose an AI provider to start
					</p>

					{/* OpenAI Codex Card */}
					<div
						aria-checked={selectedMethod === "codex"}
						className={`flex flex-col gap-3 p-4 rounded-2xl border cursor-pointer select-none transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lumi hover:-translate-y-0.5 active:translate-y-0 ${
							selectedMethod === "codex"
								? "bg-lumi/10 border-lumi shadow-[0_4px_16px_rgba(99,102,160,0.15)]"
								: "bg-muted/5 border-border-panel hover:bg-muted/10 hover:border-lumi/40"
						}`}
						onClick={() => setSelectedMethod("codex")}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								setSelectedMethod("codex")
							}
						}}
						role="radio"
						tabIndex={0}>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div
									className={`p-2 rounded-lg transition-colors ${selectedMethod === "codex" ? "bg-lumi text-lumi-foreground" : "bg-muted text-description"}`}>
									<VscIcon className="size-5" name="link" />
								</div>
								<div className="flex flex-col">
									<h3 className="font-semibold text-sm text-foreground m-0">Existing ChatGPT / Codex</h3>
									<p className="text-[11px] text-description m-0 mt-0.5 leading-normal">
										Connect with your ChatGPT subscription. No separate billing.
									</p>
								</div>
							</div>
							{openAiCodexIsAuthenticated && (
								<div className="flex items-center justify-center bg-success text-white p-1 rounded-full size-5">
									<VscIcon className="size-3.5" name="check" />
								</div>
							)}
						</div>

						{selectedMethod === "codex" && (
							<div
								className="mt-2 pt-2 border-t border-border-panel/40 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200"
								onClick={(e) => e.stopPropagation()}>
								{openAiCodexIsAuthenticated ? (
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs text-success flex items-center gap-1.5 font-medium">
											<VscIcon className="size-4" name="check" /> Ready to use
										</span>
										<VSCodeButton
											appearance="secondary"
											className="rounded-lg h-8"
											onClick={handleCodexSignOut}>
											Sign Out
										</VSCodeButton>
									</div>
								) : isWaitingForCallback ? (
									<div className="flex flex-col gap-2 p-2 rounded-lg bg-lumi/5 border border-lumi/20">
										<div className="flex items-center gap-2">
											<LumiProgressIndicator />
											<span className="text-xs text-foreground font-medium">
												Waiting for authorization...
											</span>
										</div>
										<p className="text-[10px] text-description m-0 leading-normal">
											We opened a tab in your browser. Please sign in there and authorize the connection.
										</p>
										<VSCodeButton
											appearance="secondary"
											className="w-full h-8 rounded-lg mt-1"
											onClick={() => setIsWaitingForCallback(false)}>
											Cancel
										</VSCodeButton>
									</div>
								) : (
									<VSCodeButton
										className="btn-premium-lumi w-full h-9 rounded-lg"
										disabled={isLoading}
										onClick={handleCodexSignIn}>
										<span>Connect Subscription</span>
										{isLoading && <LumiProgressIndicator />}
									</VSCodeButton>
								)}
							</div>
						)}
					</div>

					{/* Nous Research Card */}
					<div
						aria-checked={selectedMethod === "nous"}
						className={`flex flex-col gap-3 p-4 rounded-2xl border cursor-pointer select-none transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lumi hover:-translate-y-0.5 active:translate-y-0 ${
							selectedMethod === "nous"
								? "bg-lumi/10 border-lumi shadow-[0_4px_16px_rgba(99,102,160,0.15)]"
								: "bg-muted/5 border-border-panel hover:bg-muted/10 hover:border-lumi/40"
						}`}
						onClick={() => setSelectedMethod("nous")}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								setSelectedMethod("nous")
							}
						}}
						role="radio"
						tabIndex={0}>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div
									className={`p-2 rounded-lg transition-colors ${selectedMethod === "nous" ? "bg-lumi text-lumi-foreground" : "bg-muted text-description"}`}>
									<VscIcon className="size-5" name="key" />
								</div>
								<div className="flex flex-col">
									<h3 className="font-semibold text-sm text-foreground m-0">Nous Research API</h3>
									<p className="text-[11px] text-description m-0 mt-0.5 leading-normal">
										Bring your own Nous Research API key.
									</p>
								</div>
							</div>
							{nousKey.trim().length > 0 && (
								<div className="flex items-center justify-center bg-success text-white p-1 rounded-full size-5">
									<VscIcon className="size-3.5" name="check" />
								</div>
							)}
						</div>

						{selectedMethod === "nous" && (
							<div
								className="mt-2 pt-2 border-t border-border-panel/40 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200"
								onClick={(e) => e.stopPropagation()}>
								<div className="flex flex-col gap-1">
									<div className="relative flex items-center">
										<input
											className="w-full h-9 pl-3 pr-10 rounded-lg border border-input-border bg-input-background text-input-foreground placeholder:text-input-placeholder focus:outline-none focus:ring-2 focus:ring-lumi/30 focus:border-lumi text-sm transition-all duration-200"
											onChange={handleNousKeyChange}
											placeholder="Enter your API key..."
											type={showKey ? "text" : "password"}
											value={nousKey}
										/>
										<button
											className="absolute right-2 p-1 text-description hover:text-foreground bg-transparent border-none cursor-pointer focus:outline-none flex items-center justify-center"
											onClick={() => setShowKey(!showKey)}
											title={showKey ? "Hide API key" : "Show API key"}
											type="button">
											{showKey ? (
												<svg
													className="size-4"
													fill="none"
													stroke="currentColor"
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth="2"
													viewBox="0 0 24 24"
													xmlns="http://www.w3.org/2000/svg">
													<path d="M9.88 9.88a3 3 0 1 1 4.24 4.24" />
													<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
													<path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
													<line x1="2" x2="22" y1="2" y2="22" />
												</svg>
											) : (
												<svg
													className="size-4"
													fill="none"
													stroke="currentColor"
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth="2"
													viewBox="0 0 24 24"
													xmlns="http://www.w3.org/2000/svg">
													<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
													<circle cx="12" cy="12" r="3" />
												</svg>
											)}
										</button>
									</div>
									<div className="flex justify-between items-center mt-1 px-1">
										<p className="text-[10px] text-description m-0 leading-normal">
											Stored locally on your machine.
										</p>
										<a
											className="text-[10px] text-link hover:text-link-hover hover:underline"
											href="https://inference-api.nousresearch.com/"
											rel="noopener noreferrer"
											target="_blank">
											Get an API key
										</a>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				<div className="flex flex-col gap-3 mt-2">
					<VSCodeButton
						className="btn-premium-lumi h-11 w-full rounded-xl"
						disabled={!isProceedEnabled || isSaving}
						onClick={handleProceed}>
						<span className="text-base font-semibold">Let's Go</span>
						{isSaving && <LumiProgressIndicator />}
					</VSCodeButton>

					<div className="flex flex-col items-center justify-center gap-1 mt-1">
						<button
							className="text-xs text-description hover:text-foreground underline bg-transparent border-none cursor-pointer focus:outline-none"
							onClick={handleSkip}>
							Skip onboarding for now
						</button>
						<p className="text-[10px] text-description text-center m-0 leading-normal">
							You can configure your API settings at any time in Settings.
						</p>
					</div>
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
