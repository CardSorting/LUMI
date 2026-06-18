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
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		shouldShowAnnouncement,
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
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideAccount,
		hideWorktrees,
		hideJoyZoning,
		hideAnnouncement,
	} = useExtensionState()

	const { dietcodeUser, organizations, activeOrganization } = useDietCodeAuth()

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
