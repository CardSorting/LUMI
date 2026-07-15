import type { Boolean, EmptyRequest } from "@shared/proto/dietcode/common"
import { useEffect } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import JoyZoningView from "./components/joyzoning/JoyZoningView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useDietCodeAuth } from "./context/DietCodeAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { TaskServiceClient, UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		shouldShowAnnouncement,
		showHistory,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showAccount,
		showWorktrees,
		showJoyZoning,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		hideHistory,
		closeMcpView,
		hideSettings,
		hideAccount,
		hideWorktrees,
		hideJoyZoning,
		hideAnnouncement,
		navigateToHistory,
		navigateToMcp,
		navigateToSettings,
		navigateToAccount,
		navigateToChat,
	} = useExtensionState()

	const { dietcodeUser, organizations, activeOrganization } = useDietCodeAuth()

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			// Alt + Shift + H / T / S / A / C / N / 1-5
			if (event.altKey && event.shiftKey) {
				const key = event.key.toLowerCase()
				if (key === "h" || key === "2") {
					event.preventDefault()
					if (showHistory) hideHistory()
					else navigateToHistory()
				} else if (key === "t" || key === "3") {
					event.preventDefault()
					if (showMcp) closeMcpView()
					else navigateToMcp()
				} else if (key === "s" || key === "5") {
					event.preventDefault()
					if (showSettings) hideSettings()
					else navigateToSettings()
				} else if (key === "a" || key === "4") {
					event.preventDefault()
					if (showAccount) hideAccount()
					else navigateToAccount()
				} else if (key === "c") {
					event.preventDefault()
					hideHistory()
					hideSettings()
					closeMcpView()
					hideAccount()
					hideWorktrees()
					hideJoyZoning()
				} else if (key === "n" || key === "1") {
					event.preventDefault()
					const confirmed = window.confirm(
						"Are you sure you want to start a new chat? This will clear the active task and reset the conversation.",
					)
					if (confirmed) {
						hideHistory()
						hideSettings()
						closeMcpView()
						hideAccount()
						hideWorktrees()
						hideJoyZoning()
						TaskServiceClient.clearTask({})
							.catch((error) => console.error("Failed to clear task:", error))
							.finally(() => navigateToChat())
					}
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [
		showHistory,
		showMcp,
		showSettings,
		showAccount,
		hideHistory,
		navigateToHistory,
		closeMcpView,
		navigateToMcp,
		hideSettings,
		navigateToSettings,
		hideAccount,
		navigateToAccount,
		hideWorktrees,
		hideJoyZoning,
		navigateToChat,
	])

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showAccount && (
				<AccountView
					activeOrganization={activeOrganization}
					dietcodeUser={dietcodeUser}
					onDone={hideAccount}
					organizations={organizations}
				/>
			)}
			{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			{showJoyZoning && <JoyZoningView onDone={hideJoyZoning} />}
			{/* History is inline inside ChatView — keeps toolbar visible, no extra overlay pane */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showMcp || showAccount || showWorktrees || showJoyZoning}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
