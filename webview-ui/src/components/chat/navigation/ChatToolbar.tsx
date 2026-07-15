import { ArrowLeft } from "lucide-react"
import { useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CHAT_NAV_BY_ID, CHAT_TOOLBAR_ITEMS, type ChatNavItemId } from "./chatNavConfig"
import { WorkspaceNavigationMenu } from "./WorkspaceNavigationMenu"

interface ChatToolbarProps {
	hasActiveConversation?: boolean
	conversationTitle?: string
	onRequestNewChat: () => void
}

/** Compact app bar with direct high-frequency actions and labeled overflow navigation. */
export const ChatToolbar = ({ hasActiveConversation = false, conversationTitle, onRequestNewChat }: ChatToolbarProps) => {
	const {
		navigateToHistory,
		navigateToSettings,
		navigateToAccount,
		navigateToMcp,
		navigateToChat,
		showHistory,
		showMcp,
		showSettings,
		showAccount,
		showWorktrees,
		setExpandTaskHeader,
	} = useExtensionState()

	const isSubViewActive = useMemo(() => {
		return showHistory || showMcp || showSettings || showAccount || showWorktrees
	}, [showHistory, showMcp, showSettings, showAccount, showWorktrees])

	const activePanel = useMemo((): ChatNavItemId | null => {
		if (showHistory) return "history"
		if (showMcp) return "tools"
		if (showAccount) return "account"
		if (showSettings) return "settings"
		if (!isSubViewActive) return "chat"
		return null
	}, [showHistory, showMcp, showAccount, showSettings, isSubViewActive])

	const collapseTaskDetails = useCallback(() => {
		setExpandTaskHeader(false)
	}, [setExpandTaskHeader])

	const handleBackToChat = useCallback(() => {
		collapseTaskDetails()
		navigateToChat()
	}, [collapseTaskDetails, navigateToChat])

	const handleNavigate = useCallback(
		(id: ChatNavItemId) => {
			switch (id) {
				case "chat":
					handleBackToChat()
					break
				case "newChat":
					collapseTaskDetails()
					onRequestNewChat()
					break
				case "history":
					collapseTaskDetails()
					navigateToHistory()
					break
				case "tools":
					collapseTaskDetails()
					navigateToMcp()
					break
				case "account":
					collapseTaskDetails()
					navigateToAccount()
					break
				case "settings":
					collapseTaskDetails()
					navigateToSettings()
					break
			}
		},
		[
			collapseTaskDetails,
			handleBackToChat,
			navigateToAccount,
			navigateToHistory,
			navigateToMcp,
			navigateToSettings,
			onRequestNewChat,
		],
	)

	const newChatItem = CHAT_NAV_BY_ID.newChat
	const centerLabel = useMemo(() => {
		if (showHistory) return "Past chats"
		if (showMcp) return "Connected tools"
		if (showSettings) return "Settings"
		if (showAccount) return "Account"
		if (showWorktrees) return "Worktrees"
		return conversationTitle?.trim() || "Chat"
	}, [showHistory, showMcp, showSettings, showAccount, showWorktrees, conversationTitle])

	return (
		<header className="z-10 flex-none border-b border-border/40 bg-background select-none">
			<style>{`
				@keyframes lumi-tab-scale-in {
					from {
						transform: scaleX(0.2);
						opacity: 0;
					}
					to {
						transform: scaleX(1);
						opacity: 1;
					}
				}
			`}</style>
			<div className="flex h-11 items-center gap-1.5 px-2" id="lumi-chat-toolbar">
				{isSubViewActive ? (
					<Button
						aria-label="Back to chat"
						className="h-8 w-8 shrink-0 rounded-md text-foreground/80 transition-colors hover:bg-toolbar-hover hover:text-foreground focus-visible:ring-2"
						data-testid="chat-nav-back"
						onClick={handleBackToChat}
						size="icon"
						title="Back to chat"
						variant="icon">
						<ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
					</Button>
				) : (
					<Button
						aria-label={newChatItem.label}
						className="h-8 w-8 shrink-0 rounded-md text-foreground/80 transition-colors hover:bg-toolbar-hover hover:text-foreground focus-visible:ring-2"
						data-testid="chat-nav-new"
						onClick={() => handleNavigate("newChat")}
						size="icon"
						title={newChatItem.tooltip}
						variant="icon">
						<Icon name={newChatItem.icon} size={16} />
					</Button>
				)}

				<div className="min-w-0 flex-1 px-0.5">
					<h1
						aria-atomic="true"
						aria-live="polite"
						className="m-0 truncate text-xs font-semibold leading-none text-foreground"
						id="lumi-view-title"
						title={centerLabel}>
						{centerLabel}
					</h1>
					{hasActiveConversation && !isSubViewActive ? (
						<p className="m-0 mt-1 text-[9px] leading-none text-description/70">Active chat</p>
					) : null}
				</div>

				<nav aria-label="Quick navigation" className="flex shrink-0 items-center gap-0.5">
					{CHAT_TOOLBAR_ITEMS.map((item) => {
						const isActive = activePanel === item.id
						return (
							<Button
								aria-current={isActive ? "page" : undefined}
								aria-label={item.label}
								className={`h-8 w-8 rounded-md transition-colors relative flex items-center justify-center focus-visible:ring-2 ${
									isActive
										? "bg-toolbar-hover text-[var(--vscode-button-background)]"
										: "text-foreground/75 hover:bg-toolbar-hover hover:text-foreground"
								}`}
								data-testid={`chat-nav-${item.id}`}
								key={item.id}
								onClick={() => handleNavigate(item.id)}
								size="icon"
								title={item.tooltip}
								variant="icon">
								<Icon name={item.icon} size={16} />
								{isActive && (
									<div
										className="absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded-full bg-[var(--vscode-button-background)]"
										style={{
											animation: "lumi-tab-scale-in 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards",
											transformOrigin: "center",
										}}
									/>
								)}
							</Button>
						)
					})}
					<WorkspaceNavigationMenu activePanel={activePanel} onNavigate={handleNavigate} />
				</nav>
			</div>
		</header>
	)
}
