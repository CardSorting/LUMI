import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/dietcode/common"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Star } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

interface InlineHistoryPanelProps {
	onClose: () => void
	hasActiveConversation?: boolean
}

const formatWhen = (timestamp: number) => {
	const date = new Date(timestamp)
	const today = new Date()
	const yesterday = new Date()
	yesterday.setDate(yesterday.getDate() - 1)

	if (today.toDateString() === date.toDateString()) {
		return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
	}
	if (yesterday.toDateString() === date.toDateString()) {
		return "Yesterday"
	}
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const HistoryRow = memo(({ item, onOpen }: { item: HistoryItem; onOpen: (id: string) => void }) => (
	<button
		className={cn(
			"flex min-h-11 w-full items-center gap-2 border-b border-border/20 px-2.5 py-2 text-left",
			"hover:bg-[color-mix(in_srgb,var(--vscode-list-hoverBackground)_80%,transparent)]",
			"focus-visible:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--vscode-focusBorder)]",
		)}
		onClick={() => onOpen(item.id)}
		type="button">
		<div className="flex-1 min-w-0">
			<p className="ph-no-capture text-xs text-foreground m-0 line-clamp-2 leading-snug">{item.task}</p>
		</div>
		<div className="flex items-center gap-1 shrink-0">
			{item.isFavorited && (
				<Star
					aria-label="Saved"
					className="size-3 fill-[var(--vscode-button-background)] text-[var(--vscode-button-background)]"
				/>
			)}
			<span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatWhen(item.ts)}</span>
		</div>
	</button>
))
HistoryRow.displayName = "HistoryRow"

/**
 * Inline conversation list — lives inside ChatView (no full-screen overlay).
 * Familiar sidebar pattern: search, tap to resume, back via toolbar.
 */
export const InlineHistoryPanel = memo(({ onClose, hasActiveConversation = false }: InlineHistoryPanelProps) => {
	const { taskHistory, navigateToChat, setShowNewChatConfirm } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")

	const items = useMemo(() => {
		const base = taskHistory.filter((item) => item.ts && item.task).sort((a, b) => b.ts - a.ts)
		const q = searchQuery.trim().toLowerCase()
		if (!q) {
			return base
		}
		return base.filter((item) => item.task.toLowerCase().includes(q))
	}, [taskHistory, searchQuery])

	const handleOpen = useCallback(
		(id: string) => {
			TaskServiceClient.showTaskWithId(StringRequest.create({ value: id }))
				.then(() => onClose())
				.catch((error) => console.error("Error showing task:", error))
		},
		[onClose],
	)

	const handleStartNewChat = useCallback(() => {
		if (hasActiveConversation) {
			setShowNewChatConfirm(true)
		} else {
			TaskServiceClient.clearTask({})
				.catch((error) => console.error("Failed to clear task:", error))
				.finally(() => {
					onClose()
					navigateToChat()
				})
		}
	}, [hasActiveConversation, navigateToChat, onClose, setShowNewChatConfirm])

	return (
		<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
			<div className="px-2 pt-1 pb-2 shrink-0">
				<VSCodeTextField
					aria-label="Search past chats"
					className="w-full"
					onInput={(e) => setSearchQuery((e.target as HTMLInputElement)?.value ?? "")}
					placeholder="Search chats…"
					value={searchQuery}>
					<Icon className="opacity-70 !text-xs mt-0.5" name="search" slot="start" />
					{searchQuery && (
						<button
							aria-label="Clear search"
							className="input-icon-button flex h-7 w-7 items-center justify-center rounded border-0 bg-transparent text-foreground focus-visible:outline-2 focus-visible:outline-[var(--vscode-focusBorder)]"
							onClick={() => setSearchQuery("")}
							slot="end"
							type="button">
							<Icon name="close" size={14} />
						</button>
					)}
				</VSCodeTextField>
			</div>

			{items.length === 0 ? (
				<output className="flex-1 flex items-center justify-center px-4 text-center">
					<span className="text-xs text-muted-foreground">
						{searchQuery ? "No chats match your search." : "No past conversations yet."}
					</span>
				</output>
			) : (
				<Virtuoso
					aria-label="Past chats"
					className="flex-1"
					data={items}
					itemContent={(index) => <HistoryRow item={items[index]} onOpen={handleOpen} />}
				/>
			)}

			<div className="flex shrink-0 gap-2 border-t border-border/30 p-2">
				<Button className="h-8 min-w-0 flex-1 px-2 text-[11px]" onClick={onClose} variant="outline">
					Back to chat
				</Button>
				<Button className="h-8 min-w-0 flex-1 px-2 text-[11px]" onClick={handleStartNewChat}>
					New chat
				</Button>
			</div>
		</div>
	)
})

InlineHistoryPanel.displayName = "InlineHistoryPanel"
