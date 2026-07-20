import type { Boolean, EmptyRequest } from "@shared/proto/dietcode/common"
import { useCallback, useEffect, useMemo, useState } from "react"
import ChatView from "./components/chat/ChatView"
import { ChatToolbar } from "./components/chat/navigation/ChatToolbar"
import { NewChatConfirmModal } from "./components/common/NewChatConfirmModal"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useDietCodeAuth } from "./context/DietCodeAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { TaskServiceClient, UiServiceClient } from "./services/grpc-client"

const isEditableTarget = (target: EventTarget | null) => {
	if (!(target instanceof HTMLElement)) return false
	const tagName = target.tagName.toLowerCase()
	return (
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select" ||
		target.isContentEditable ||
		tagName.startsWith("vscode-")
	)
}

const AppContent = () => {
	const {
		didHydrateState,
		shouldShowAnnouncement,
		showWelcome,
		showHistory,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showWorktrees,
		showAnnouncement,
		showNewChatConfirm,
		dietcodeMessages,
		setShowAnnouncement,
		setShowNewChatConfirm,
		setShouldShowAnnouncement,
		closeMcpView,
		hideSettings,
		hideWorktrees,
		hideAnnouncement,
		navigateToHistory,
		navigateToMcp,
		navigateToSettings,
		navigateToChat,
		navigateToWorktrees,
	} = useExtensionState()

	const { dietcodeUser, organizations, activeOrganization } = useDietCodeAuth()
	const [isStartingNewChat, setIsStartingNewChat] = useState(false)
	const [newChatError, setNewChatError] = useState<string | null>(null)

	const task = useMemo(() => dietcodeMessages.at(0), [dietcodeMessages])
	const hasActiveConversation = !!task
	const conversationTitle = useMemo(() => {
		if (!task?.text) {
			return undefined
		}
		const singleLine = task.text.replace(/\s+/g, " ").trim()
		return singleLine.length > 36 ? `${singleLine.slice(0, 36)}…` : singleLine
	}, [task?.text])

	const handleRequestNewChat = useCallback(() => {
		setNewChatError(null)
		if (hasActiveConversation) {
			setShowNewChatConfirm(true)
			return
		}

		TaskServiceClient.clearTask({})
			.then(() => navigateToChat())
			.catch((error) => console.error("Failed to start a new chat:", error))
	}, [hasActiveConversation, navigateToChat, setShowNewChatConfirm])

	const handleCancelNewChat = useCallback(() => {
		if (isStartingNewChat) return
		setNewChatError(null)
		setShowNewChatConfirm(false)
	}, [isStartingNewChat, setShowNewChatConfirm])

	const handleConfirmNewChat = useCallback(async () => {
		if (isStartingNewChat) return
		setIsStartingNewChat(true)
		setNewChatError(null)

		try {
			await TaskServiceClient.clearTask({})
			setShowNewChatConfirm(false)
			navigateToChat()
		} catch (error) {
			console.error("Failed to start a new chat:", error)
			setNewChatError("Couldn’t start a new chat. Please try again.")
		} finally {
			setIsStartingNewChat(false)
		}
	}, [isStartingNewChat, navigateToChat, setShowNewChatConfirm])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || showNewChatConfirm || showWelcome) return

			if (
				event.key === "Escape" &&
				(showHistory || showMcp || showSettings || showWorktrees) &&
				!isEditableTarget(event.target)
			) {
				event.preventDefault()
				navigateToChat()
				return
			}

			// Alt + Shift + H / T / S / A / C / N / 1-5
			if (event.altKey && event.shiftKey) {
				const key = event.key.toLowerCase()
				if (key === "h" || key === "2") {
					event.preventDefault()
					navigateToHistory()
				} else if (key === "t" || key === "3") {
					event.preventDefault()
					navigateToMcp()
				} else if (key === "s" || key === "5") {
					event.preventDefault()
					navigateToSettings()
				} else if (key === "w" || key === "6") {
					event.preventDefault()
					navigateToWorktrees()
				} else if (key === "c") {
					event.preventDefault()
					navigateToChat()
				} else if (key === "n" || key === "1") {
					event.preventDefault()
					handleRequestNewChat()
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [
		showWelcome,
		showHistory,
		showMcp,
		showSettings,
		showWorktrees,
		showNewChatConfirm,
		navigateToHistory,
		navigateToMcp,
		navigateToSettings,
		navigateToChat,
		navigateToWorktrees,
		handleRequestNewChat,
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
		<div className="flex h-screen w-full flex-col bg-background">
			<a
				className="sr-only z-50 rounded bg-button-background px-3 py-2 text-button-foreground focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
				href="#lumi-main-content">
				Skip to content
			</a>
			{showWelcome ? (
				<WelcomeView />
			) : (
				<>
					<ChatToolbar
						conversationTitle={conversationTitle}
						hasActiveConversation={hasActiveConversation}
						onRequestNewChat={handleRequestNewChat}
					/>
					<main
						aria-labelledby="lumi-view-title"
						className="relative min-h-0 w-full flex-1 overflow-hidden"
						id="lumi-main-content"
						tabIndex={-1}>
						{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
						{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
						{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
						<ChatView
							hideAnnouncement={hideAnnouncement}
							isHidden={showSettings || showMcp || showWorktrees}
							showAnnouncement={showAnnouncement}
							showHistoryView={navigateToHistory}
						/>
					</main>
				</>
			)}
			<NewChatConfirmModal
				error={newChatError}
				isOpen={showNewChatConfirm}
				isPending={isStartingNewChat}
				onCancel={handleCancelNewChat}
				onConfirm={handleConfirmNewChat}
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
