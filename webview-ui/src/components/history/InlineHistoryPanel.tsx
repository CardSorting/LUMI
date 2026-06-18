import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/dietcode/common"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Star } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

interface InlineHistoryPanelProps {
	onClose: () => void
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
			"w-full text-left flex items-center gap-2 px-2.5 py-2 border-b border-border/20",
			"hover:bg-[color-mix(in_srgb,var(--vscode-list-hoverBackground)_80%,transparent)]",
			"focus-visible:outline-none focus-visible:bg-accent/15",
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
export const InlineHistoryPanel = memo(({ onClose }: InlineHistoryPanelProps) => {
	const { taskHistory, navigateToChat } = useExtensionState()
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
		TaskServiceClient.clearTask({})
			.catch((error) => console.error("Failed to clear task:", error))
			.finally(() => {
				onClose()
				navigateToChat()
			})
	}, [navigateToChat, onClose])

	return (
		<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
			<div className="px-2 pt-1 pb-2 shrink-0">
				<VSCodeTextField
					className="w-full"
					onInput={(e) => setSearchQuery((e.target as HTMLInputElement)?.value ?? "")}
					placeholder="Search chats…"
					value={searchQuery}>
					<Icon className="opacity-70 !text-xs mt-0.5" name="search" slot="start" />
					{searchQuery && (
						<Icon
							aria-label="Clear search"
							className="input-icon-button flex justify-center items-center h-full"
							name="close"
							onClick={() => setSearchQuery("")}
							slot="end"
						/>
					)}
				</VSCodeTextField>
			</div>

			{items.length === 0 ? (
				<div className="flex-1 flex items-center justify-center px-4 text-center">
					<p className="text-xs text-muted-foreground m-0">
						{searchQuery ? "No chats match your search." : "No past conversations yet."}
					</p>
				</div>
			) : (
				<>
					<Virtuoso
						className="flex-1"
						data={items}
						itemContent={(index) => <HistoryRow item={items[index]} onOpen={handleOpen} />}
					/>
					<p className="shrink-0 px-3 py-2 m-0 text-center text-[10px] text-muted-foreground border-t border-border/20">
						Tap a chat to continue, or{" "}
						<button
							className="underline bg-transparent border-0 p-0 cursor-pointer text-inherit hover:text-foreground"
							onClick={handleStartNewChat}
							type="button">
							start a new chat
						</button>
					</p>
				</>
			)}
		</div>
	)
})

InlineHistoryPanel.displayName = "InlineHistoryPanel"
