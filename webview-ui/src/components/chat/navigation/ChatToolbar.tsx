import { ArrowLeft, ChevronDown } from "lucide-react"
import { useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { CHAT_NAV_BY_ID, CHAT_TOOLBAR_ITEMS, type ChatNavItemId } from "./chatNavConfig"

interface ChatToolbarProps {
	hasActiveConversation?: boolean
	/** Truncated task prompt — tap to expand/collapse task details. */
	conversationTitle?: string
}

/**
 * Compact toolbar for narrow VS Code sidebars — icon buttons only, no overflow menu.
 */
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
		expandTaskHeader,
		setExpandTaskHeader,
	} = useExtensionState()

	const toggleTaskDetails = useCallback(() => {
		setExpandTaskHeader(!expandTaskHeader)
	}, [expandTaskHeader, setExpandTaskHeader])

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
					if (showHistory) {
						hideHistory()
					} else {
						navigateToHistory()
					}
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
			hideHistory,
			navigateToAccount,
			navigateToChat,
			navigateToHistory,
			navigateToMcp,
			navigateToSettings,
			collapseTaskDetails,
			showHistory,
		],
	)

	const newChatItem = CHAT_NAV_BY_ID.newChat
	const centerLabel = showHistory ? "Past chats" : conversationTitle?.trim() || "Chat"

	return (
		<div className="flex-none border-b border-border/30 bg-background z-10">
			<div className="flex items-center gap-1 px-2 h-9" id="lumi-chat-toolbar">
				{showHistory ? (
					<Button
						aria-label="Back to chat"
						className="h-7 w-7 shrink-0 rounded-md"
						data-testid="chat-nav-back"
						onClick={hideHistory}
						size="icon"
						title="Back to chat"
						variant="icon">
						<ArrowLeft aria-hidden className="size-4" strokeWidth={2} />
					</Button>
				) : (
					<Button
						aria-label={newChatItem.label}
						className="h-7 w-7 shrink-0 rounded-md"
						data-testid="chat-nav-new"
						onClick={() => handleNavigate("newChat")}
						size="icon"
						title={newChatItem.tooltip}
						variant="icon">
						<Icon className="stroke-[1.75] [svg]:size-4" name={newChatItem.icon} size={16} />
					</Button>
				)}

				<div className="flex-1 min-w-0 px-0.5 flex items-center gap-1">
					{hasActiveConversation && conversationTitle && !showHistory ? (
						<button
							aria-expanded={expandTaskHeader}
							className={cn(
								"flex-1 min-w-0 flex items-center gap-0.5 text-left",
								"bg-transparent border-0 cursor-pointer p-0",
								"hover:[&>span]:underline",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
							)}
							onClick={toggleTaskDetails}
							title={expandTaskHeader ? "Hide task details" : `${centerLabel} — show details`}
							type="button">
							{expandTaskHeader ? (
								<ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
							) : null}
							<span className="text-[11px] truncate m-0 leading-none font-medium text-foreground">
								{centerLabel}
							</span>
						</button>
					) : (
						<p
							className={cn(
								"flex-1 text-[11px] truncate m-0 leading-none font-medium",
								showHistory || conversationTitle ? "text-foreground" : "text-muted-foreground",
							)}
							title={centerLabel}>
							{centerLabel}
						</p>
					)}
				</div>

				<nav aria-label="Chat navigation" className="flex items-center gap-0.5 shrink-0">
					{CHAT_TOOLBAR_ITEMS.map((item) => {
						const isActive = activePanel === item.id
						return (
							<Button
								aria-current={isActive ? "page" : undefined}
								aria-label={item.label}
								className={cn(
									"h-7 w-7 rounded-md",
									isActive && "bg-accent/20 text-foreground ring-1 ring-border/50",
								)}
								data-testid={`chat-nav-${item.id}`}
								key={item.id}
								onClick={() => handleNavigate(item.id)}
								size="icon"
								title={item.tooltip}
								variant="icon">
								<Icon className="stroke-[1.5] [svg]:size-4" name={item.icon} size={16} />
							</Button>
						)
					})}
				</nav>
			</div>
		</div>
	)
}
