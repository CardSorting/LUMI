import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ArrowLeft, ChevronDown, MoreHorizontal } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { TaskStatusChip } from "@/components/chat/task-header/TaskStatusChip"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { CHAT_NAV_BY_ID, CHAT_OVERFLOW_ITEMS, CHAT_TOOLBAR_ITEMS, type ChatNavItemId } from "./chatNavConfig"

export interface TaskToolbarStatus {
	auditHealth?: AuditHealthSummary
	auditMetadata?: TaskAuditMetadata
	subagentAuditSummary?: SubagentAuditSummary
}

interface ChatToolbarProps {
	hasActiveConversation?: boolean
	/** Truncated task prompt — tap to expand/collapse task details. */
	conversationTitle?: string
	taskStatus?: TaskToolbarStatus
}

/**
 * Compact toolbar for narrow VS Code sidebars.
 * Overflow menu pushes content down (inline) — no floating overlays.
 */
export const ChatToolbar = ({ hasActiveConversation = false, conversationTitle, taskStatus }: ChatToolbarProps) => {
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

	const overflowRef = useRef<HTMLDetailsElement>(null)

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

	const handleOverflowSelect = useCallback(
		(id: ChatNavItemId) => {
			if (id !== "history") hideHistory()
			handleNavigate(id)
			if (overflowRef.current) {
				overflowRef.current.open = false
			}
		},
		[handleNavigate, hideHistory],
	)

	useEffect(() => {
		if (expandTaskHeader && overflowRef.current?.open) {
			overflowRef.current.open = false
		}
	}, [expandTaskHeader])

	useEffect(() => {
		const closeOnOutside = (e: MouseEvent) => {
			if (overflowRef.current?.open && !overflowRef.current.contains(e.target as Node)) {
				overflowRef.current.open = false
			}
		}
		document.addEventListener("mousedown", closeOnOutside)
		return () => document.removeEventListener("mousedown", closeOnOutside)
	}, [])

	const newChatItem = CHAT_NAV_BY_ID.newChat
	const centerLabel = showHistory ? "Past chats" : conversationTitle?.trim() || "Chat"

	const overflowActive = CHAT_OVERFLOW_ITEMS.some((item) => item.id === activePanel)

	return (
		<details className="lumi-toolbar-shell flex-none border-b border-border/30 bg-background z-10" ref={overflowRef}>
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
								"bg-transparent border-0 cursor-pointer p-0 group",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
							)}
							onClick={toggleTaskDetails}
							title={expandTaskHeader ? "Hide task details" : `${centerLabel} — show details`}
							type="button">
							{expandTaskHeader ? (
								<ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
							) : null}
							<span className="text-[11px] truncate m-0 leading-none font-medium text-foreground group-hover:underline">
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
					{hasActiveConversation && !showHistory && !expandTaskHeader && taskStatus ? (
						<TaskStatusChip
							auditHealth={taskStatus.auditHealth}
							auditMetadata={taskStatus.auditMetadata}
							onExpand={() => setExpandTaskHeader(true)}
							subagentAuditSummary={taskStatus.subagentAuditSummary}
						/>
					) : null}
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
					<summary
						aria-label="More options"
						className={cn(
							"lumi-details-trigger flex items-center justify-center h-7 w-7 rounded-md cursor-pointer list-none",
							"hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							overflowActive && "bg-accent/20 text-foreground ring-1 ring-border/50",
						)}
						title="Preferences, tools, and account">
						<MoreHorizontal aria-hidden className="size-4" strokeWidth={2} />
					</summary>
				</nav>
			</div>

			<nav
				aria-label="More navigation"
				className="lumi-toolbar-overflow-panel flex flex-col border-t border-border/20 px-2 py-1.5 gap-0.5">
				{CHAT_OVERFLOW_ITEMS.map((item) => {
					const isActive = activePanel === item.id
					return (
						<button
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs text-left",
								"hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								isActive && "bg-accent/20 font-medium",
							)}
							key={item.id}
							onClick={() => handleOverflowSelect(item.id)}
							type="button">
							<Icon className="stroke-[1.5] [svg]:size-3.5 shrink-0 opacity-80" name={item.icon} size={14} />
							<span>{item.label}</span>
						</button>
					)
				})}
			</nav>
		</details>
	)
}
