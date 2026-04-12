import type { Boolean, EmptyRequest } from "@shared/proto/codemarie/common"
import { useEffect, useMemo } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import MobileLayout from "./components/layout/MobileLayout"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import OnboardingView from "./components/onboarding/OnboardingView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useCodemarieAuth } from "./context/CodemarieAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		onboardingModels,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		navigateToSettings,
		navigateToMcp,
		navigateToAccount,
		navigateToChat,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
	} = useExtensionState()

	const { codemarieUser, organizations, activeOrganization } = useCodemarieAuth()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					// biome-ignore lint/suspicious/noConsole: No Logger service available in remote-ui
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	const activeTab = useMemo(() => {
		if (showSettings) return "settings"
		if (showHistory) return "history"
		if (showMcp) return "mcp"
		if (showAccount) return "account"
		return "chat"
	}, [showSettings, showHistory, showMcp, showAccount])

	const handleTabChange = (tab: "chat" | "history" | "mcp" | "account" | "settings") => {
		switch (tab) {
			case "chat":
				navigateToChat()
				break
			case "history":
				navigateToHistory()
				break
			case "mcp":
				navigateToMcp()
				break
			case "account":
				navigateToAccount()
				break
			case "settings":
				navigateToSettings()
				break
		}
	}

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return onboardingModels ? <OnboardingView onboardingModels={onboardingModels} /> : <WelcomeView />
	}

	const content = (
		<>
			{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showAccount && (
				<AccountView
					activeOrganization={activeOrganization}
					codemarieUser={codemarieUser}
					onDone={hideAccount}
					organizations={organizations}
				/>
			)}
			{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMcp || showAccount || showWorktrees}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</>
	)

	return (
		<MobileLayout activeTab={activeTab} onTabChange={handleTabChange}>
			{content}
		</MobileLayout>
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
