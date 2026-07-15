import { ArrowLeft } from "lucide-react"
import { useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { CHAT_NAV_BY_ID, CHAT_TOOLBAR_ITEMS, type ChatNavItemId } from "./chatNavConfig"

interface ChatToolbarProps {
	hasActiveConversation?: boolean
	conversationTitle?: string
}

/** Compact workspace navigation. Core destinations are laid out directly in a unified row. */
export const ChatToolbar = ({ hasActiveConversation = false, conversationTitle }: ChatToolbarProps) => {
	const {
		navigateToHistory,
		navigateToSettings,
		navigateToAccount,
		navigateToMcp,
		navigateToChat,
		hideHistory,
		showHistory,
		showMcp,
		showSettings,
		showAccount,
		setExpandTaskHeader,
	} = useExtensionState()

	const activePanel = useMemo((): ChatNavItemId | null => {
		if (showHistory) return "history"
		if (showMcp) return "tools"
		if (showAccount) return "account"
		if (showSettings) return "settings"
		return null
	}, [showHistory, showMcp, showAccount, showSettings])

	const collapseTaskDetails = useCallback(() => {
		setExpandTaskHeader(false)
	}, [setExpandTaskHeader])

	const handleNavigate = useCallback(
		(id: ChatNavItemId) => {
			switch (id) {
				case "newChat":
					if (hasActiveConversation) {
						const confirmed = window.confirm(
							"Are you sure you want to start a new chat? This will clear the active task and reset the conversation.",
						)
						if (!confirmed) {
							break
						}
					}
					collapseTaskDetails()
					hideHistory()
					TaskServiceClient.clearTask({})
						.catch((error) => console.error("Failed to clear task:", error))
						.finally(() => navigateToChat())
					break
				case "history":
					collapseTaskDetails()
					if (showHistory) hideHistory()
					else navigateToHistory()
					break
				case "tools":
					collapseTaskDetails()
					hideHistory()
					navigateToMcp()
					break
				case "account":
					collapseTaskDetails()
					hideHistory()
					navigateToAccount()
					break
				case "settings":
					collapseTaskDetails()
					hideHistory()
					navigateToSettings()
					break
			}
		},
		[
			collapseTaskDetails,
			hasActiveConversation,
			hideHistory,
			navigateToAccount,
			navigateToChat,
			navigateToHistory,
			navigateToMcp,
			navigateToSettings,
			showHistory,
		],
	)

	const newChatItem = CHAT_NAV_BY_ID.newChat
	const centerLabel = showHistory ? "Past chats" : conversationTitle?.trim() || "Chat"

	return (
		<header className="z-10 flex-none border-b border-border/40 bg-background">
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
			<div className="flex h-11 items-center gap-2 px-3" id="lumi-chat-toolbar">
				{showHistory ? (
					<Button
						aria-label="Back to chat"
						className="h-8 w-8 shrink-0 rounded-md text-foreground/75 hover:bg-toolbar-hover hover:text-foreground transition-all focus-visible:ring-1 focus-visible:ring-foreground"
						data-testid="chat-nav-back"
						onClick={hideHistory}
						size="icon"
						title="Back to chat"
						variant="icon">
						<ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
					</Button>
				) : (
					<Button
						aria-label={newChatItem.label}
						className="h-8 w-8 shrink-0 rounded-md text-foreground/75 hover:bg-toolbar-hover hover:text-foreground transition-all focus-visible:ring-1 focus-visible:ring-foreground"
						data-testid="chat-nav-new"
						onClick={() => handleNavigate("newChat")}
						size="icon"
						title={newChatItem.tooltip}
						variant="icon">
						<Icon name={newChatItem.icon} size={16} />
					</Button>
				)}

				<div className="min-w-0 flex-1">
					<p className="m-0 truncate text-[11px] font-semibold leading-none text-foreground" title={centerLabel}>
						{centerLabel}
					</p>
					{hasActiveConversation && !showHistory ? (
						<p className="m-0 mt-1 text-[9px] leading-none text-description/70">Governed execution</p>
					) : null}
				</div>

				<nav aria-label="Workspace navigation" className="flex shrink-0 items-center gap-0.5">
					{CHAT_TOOLBAR_ITEMS.map((item) => {
						const isActive = activePanel === item.id
						return (
							<Button
								aria-current={isActive ? "page" : undefined}
								aria-label={item.label}
								className={`h-8 w-8 rounded-md transition-all relative flex items-center justify-center focus-visible:ring-1 focus-visible:ring-foreground ${
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
				</nav>
			</div>
		</header>
	)
}
