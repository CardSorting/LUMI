import { ArrowLeft, MoreHorizontal } from "lucide-react"
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

/** Compact workspace navigation. Secondary destinations live in a familiar overflow menu. */
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
	const historyItem = CHAT_NAV_BY_ID.history
	const centerLabel = showHistory ? "Past chats" : conversationTitle?.trim() || "Chat"
	const overflowItems = CHAT_TOOLBAR_ITEMS.filter((item) => item.id !== "history")

	return (
		<header className="z-10 flex-none border-b border-border/40 bg-background">
			<div className="flex h-11 items-center gap-2 px-3" id="lumi-chat-toolbar">
				{showHistory ? (
					<Button
						aria-label="Back to chat"
						className="h-8 w-8 shrink-0 rounded-md"
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
						className="h-8 w-8 shrink-0 rounded-md"
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

				<nav aria-label="Workspace navigation" className="flex shrink-0 items-center gap-1">
					{!showHistory ? (
						<Button
							aria-current={activePanel === "history" ? "page" : undefined}
							aria-label={historyItem.label}
							className="h-8 w-8 rounded-md"
							data-testid="chat-nav-history"
							onClick={() => handleNavigate("history")}
							size="icon"
							title={historyItem.tooltip}
							variant="icon">
							<Icon name={historyItem.icon} size={16} />
						</Button>
					) : null}

					<details className="lumi-details-menu group relative">
						<summary
							aria-label="More navigation"
							className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-foreground transition-colors hover:bg-toolbar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							title="More navigation">
							<MoreHorizontal aria-hidden className="size-4" strokeWidth={1.75} />
						</summary>
						<div className="absolute right-0 top-9 z-50 min-w-44 rounded-lg border border-menu-border bg-menu p-1.5 text-menu-foreground shadow-lg">
							{overflowItems.map((item) => (
								<Button
									aria-current={activePanel === item.id ? "page" : undefined}
									aria-label={item.label}
									className="flex h-8 w-full justify-start gap-2 rounded-md px-2 text-[11px] hover:bg-list-hover"
									data-testid={`chat-nav-${item.id}`}
									key={item.id}
									onClick={() => handleNavigate(item.id)}
									title={item.tooltip}
									variant="ghost">
									<Icon name={item.icon} size={16} />
									<span>{item.label}</span>
								</Button>
							))}
						</div>
					</details>
				</nav>
			</div>
		</header>
	)
}
