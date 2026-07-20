import { UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/index.dietcode"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "../../../services/grpc-client"
import Section from "../Section"
import TerminalOutputLineLimitSlider from "../TerminalOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

interface TerminalSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

export const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({ renderSectionHeader }) => {
	const { shellIntegrationTimeout, terminalReuseEnabled, defaultTerminalProfile, availableTerminalProfiles } =
		useExtensionState()

	const [inputValue, setInputValue] = useState((shellIntegrationTimeout / 1000).toString())
	const [inputError, setInputError] = useState<string | null>(null)

	const handleTimeoutChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const value = target.value

		setInputValue(value)

		const seconds = Number.parseFloat(value)
		if (Number.isNaN(seconds) || seconds <= 0) {
			setInputError("Please enter a positive number")
			return
		}

		setInputError(null)
		const timeoutMs = Math.round(seconds * 1000)

		StateServiceClient.updateTerminalConnectionTimeout({ timeoutMs })
			.then((response: UpdateTerminalConnectionTimeoutResponse) => {
				const timeoutMs = response.timeoutMs
				// Backend calls postStateToWebview(), so state will update via subscription
				// Just sync the input value with the confirmed backend value
				if (timeoutMs !== undefined) {
					setInputValue((timeoutMs / 1000).toString())
				}
			})
			.catch((error) => {
				console.error("Failed to update terminal connection timeout:", error)
			})
	}

	const handleInputBlur = () => {
		if (inputError) {
			setInputValue((shellIntegrationTimeout / 1000).toString())
			setInputError(null)
		}
	}

	const handleTerminalReuseChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const checked = target.checked
		updateSetting("terminalReuseEnabled", checked)
	}

	// Use any to avoid type conflicts between Event and FormEvent
	const handleDefaultTerminalProfileChange = (event: any) => {
		const target = event.target as HTMLSelectElement
		const profileId = target.value

		// Save immediately using the consolidated updateSettings approach
		updateSetting("defaultTerminalProfile", profileId || "default")
	}

	const handleResetTerminalSettings = () => {
		updateSetting("defaultTerminalProfile", "default")
		updateSetting("terminalReuseEnabled", true)
		updateSetting("terminalOutputLineLimit", 500)

		StateServiceClient.updateTerminalConnectionTimeout({ timeoutMs: 2000 })
			.then((response: UpdateTerminalConnectionTimeoutResponse) => {
				const confirmedTimeoutMs = response.timeoutMs
				if (confirmedTimeoutMs !== undefined) {
					setInputValue((confirmedTimeoutMs / 1000).toString())
				}
			})
			.catch((error) => {
				console.error("Failed to reset terminal connection timeout:", error)
			})
	}

	const profilesToShow = availableTerminalProfiles

	return (
		<div>
			{renderSectionHeader("terminal")}
			<Section>
				<div className="mb-5" id="terminal-settings-section">
					<div className="mb-4">
						<label className="font-medium block mb-1" htmlFor="default-terminal-profile">
							Default Terminal Profile
						</label>
						<VSCodeDropdown
							className="w-full"
							id="default-terminal-profile"
							onChange={handleDefaultTerminalProfileChange}
							value={defaultTerminalProfile || "default"}>
							{profilesToShow.map((profile) => (
								<VSCodeOption key={profile.id} title={profile.description} value={profile.id}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-xs text-(--vscode-descriptionForeground) mt-1">
							Choose the terminal type LUMI will open. 'Default' automatically matches your active VS Code profile.
						</p>
					</div>

					<div className="mb-4">
						<div className="mb-2">
							<label className="font-medium block mb-1">Shell Connection Timeout (seconds)</label>
							<div className="flex items-center">
								<VSCodeTextField
									className="w-full"
									onBlur={handleInputBlur}
									onChange={(event) => handleTimeoutChange(event as Event)}
									placeholder="Enter timeout in seconds"
									value={inputValue}
								/>
							</div>
							{inputError && <div className="text-(--vscode-errorForeground) text-xs mt-1">{inputError}</div>}
						</div>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							How long LUMI waits for VS Code shell integration to activate. If it fails or is disabled, LUMI uses
							an automatic backup command runner. Lowering this speeds up starts on slow shell setups.
						</p>
					</div>

					<div className="mb-4">
						<div className="flex items-center mb-2">
							<VSCodeCheckbox
								checked={terminalReuseEnabled ?? true}
								onChange={(event) => handleTerminalReuseChange(event as Event)}>
								Reuse active terminal tabs
							</VSCodeCheckbox>
						</div>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							When enabled, LUMI will reuse open terminal windows to execute new commands, automatically navigating
							to the correct directory. Uncheck this if you experience command lockouts or process conflicts.
						</p>
					</div>
					<TerminalOutputLineLimitSlider />

					<div className="mt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-4 border-t border-border/20">
						<span className="text-xs text-(--vscode-descriptionForeground)">
							Troubleshoot by resetting all terminal settings back to default values.
						</span>
						<VSCodeButton appearance="secondary" onClick={handleResetTerminalSettings}>
							Reset Terminal Settings
						</VSCodeButton>
					</div>

					<div className="mt-5 p-3 bg-(--vscode-textBlockQuote-background) rounded border border-(--vscode-textBlockQuote-border)">
						<p className="text-[13px] m-0">
							<strong>Having terminal issues?</strong> Check our{" "}
							<a
								className="text-(--vscode-textLink-foreground) underline hover:no-underline"
								href="https://docs.dietcode.bot/troubleshooting/terminal-quick-fixes"
								rel="noopener noreferrer"
								target="_blank">
								Terminal Quick Fixes
							</a>{" "}
							or the{" "}
							<a
								className="text-(--vscode-textLink-foreground) underline hover:no-underline"
								href="https://docs.dietcode.bot/troubleshooting/terminal-integration-guide"
								rel="noopener noreferrer"
								target="_blank">
								Complete Troubleshooting Guide
							</a>
							.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default TerminalSettingsSection
