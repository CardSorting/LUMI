import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { Activity } from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import { useIsCompact } from "@/context/DensityContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { isToolGroup } from "../../utils/messageUtils"
import { createMessageRenderer } from "../messages/MessageRenderer"

interface MessagesAreaProps {
	task: DietCodeMessage
	groupedMessages: (DietCodeMessage | DietCodeMessage[])[]
	modifiedMessages: DietCodeMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
}

/**
 * The scrollable messages area with virtualized list
 * Handles rendering of chat rows and browser sessions
 */
export const MessagesArea: React.FC<MessagesAreaProps> = ({
	task,
	groupedMessages,
	modifiedMessages,
	scrollBehavior,
	chatState,
	messageHandlers,
}) => {
	const { dietcodeMessages } = useExtensionState()
	const lastRawMessage = useMemo(() => dietcodeMessages.at(-1), [dietcodeMessages])
	const isCompact = useIsCompact()

	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		setShowScrollToBottom,
		disableAutoScrollRef,
		handleRangeChanged,
	} = scrollBehavior

	const { expandedRows, inputValue, setPendingQuote } = chatState
	const lastVisibleRow = useMemo(() => groupedMessages.at(-1), [groupedMessages])
	const lastVisibleMessage = useMemo(() => {
		const lastRow = lastVisibleRow
		if (!lastRow) {
			return undefined
		}
		return Array.isArray(lastRow) ? lastRow.at(-1) : lastRow
	}, [lastVisibleRow])

	// Show "Thinking..." until real content starts streaming.
	// This is the sole early loading indicator - RequestStartRow does NOT duplicate it.
	// Covers: pre-api_req_started (backend processing) AND post-api_req_started (waiting for model).
	// Hides once reasoning, tools, text, or any other content message appears.
	const isWaitingForResponse = useMemo(() => {
		const lastMsg = modifiedMessages[modifiedMessages.length - 1]

		// Never show thinking while waiting on user input (any ask state).
		// This includes completion_result, tool approvals, followups, and resume asks.
		if (lastRawMessage?.type === "ask") {
			return false
		}
		// attempt_completion emits a final say("completion_result") before ask("completion_result").
		// Treat that final completion message as non-waiting to avoid a brief footer flicker.
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "completion_result") {
			return false
		}
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "api_req_started") {
			try {
				const info = JSON.parse(lastRawMessage.text || "{}")
				if (info.cancelReason === "user_cancelled") {
					return false
				}
			} catch {
				// ignore parse errors
			}
		}

		// Always show while task has started but no visible rows are rendered yet.
		if (groupedMessages.length === 0) {
			return true
		}

		// Defensive guard for transient states where a grouped row exists
		// but we still cannot resolve a concrete visible message.
		if (!lastVisibleMessage) {
			return true
		}

		// Always show when the last rendered row is a toolgroup.
		if (lastVisibleRow && isToolGroup(lastVisibleRow)) {
			return true
		}

		// User-requested behavior:
		// if the last visible row is not actively partial, always show Thinking in the footer.
		// (some rows like checkpoint_created don't set `partial`, and should be treated as non-partial)
		if (lastVisibleMessage.partial !== true) {
			return true
		}

		if (!lastMsg) {
			// No messages after the initial task message - new task just started
			return true
		}
		if (lastMsg.say === "user_feedback" || lastMsg.say === "user_feedback_diff") return true
		if (lastMsg.say === "api_req_started") {
			try {
				const info = JSON.parse(lastMsg.text || "{}")
				// Still in progress (no cost) and nothing has streamed after it yet
				return info.cost == null
			} catch {
				return true
			}
		}
		return false
	}, [lastRawMessage, groupedMessages.length, lastVisibleMessage, lastVisibleRow, modifiedMessages])

	// Keep loader in the message flow (not footer). During handoff from waiting -> reasoning stream,
	// keep the loader mounted until a real reasoning row is visible.
	const showThinkingLoaderRow = useMemo(() => {
		const handoffToReasoningPending =
			lastRawMessage?.type === "say" &&
			lastRawMessage.say === "reasoning" &&
			lastRawMessage.partial === true &&
			lastVisibleMessage?.say !== "reasoning"

		// Mirror the old footer behavior exactly: show whenever waiting logic says so.
		// Plus a brief handoff guard while grouped rows catch up to raw reasoning stream.
		return isWaitingForResponse || handoffToReasoningPending
	}, [isWaitingForResponse, lastRawMessage, lastVisibleMessage?.say])

	const displayedGroupedMessages = useMemo<(DietCodeMessage | DietCodeMessage[])[]>(() => {
		if (!showThinkingLoaderRow) {
			return groupedMessages
		}
		const waitingRow: DietCodeMessage = {
			ts: Number.MIN_SAFE_INTEGER,
			type: "say",
			say: "reasoning",
			partial: true,
			text: "",
		}
		return [...groupedMessages, waitingRow]
	}, [groupedMessages, showThinkingLoaderRow])

	const itemContent = useMemo(
		() =>
			createMessageRenderer(
				displayedGroupedMessages,
				modifiedMessages,
				expandedRows,
				toggleRowExpansion,
				handleRowHeightChange,
				setPendingQuote,
				inputValue,
				messageHandlers,
				false,
				chatState,
				task,
			),
		[
			displayedGroupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			setPendingQuote,
			inputValue,
			messageHandlers,
			chatState,
			task,
		],
	)

	// Keep footer as a simple spacer. Thinking loading is rendered as an in-list row.
	const virtuosoComponents = useMemo(
		() => ({
			Footer: () => <div className="min-h-1" />,
		}),
		[],
	)

	return (
		<section aria-label="Execution timeline" className="overflow-hidden flex flex-col h-full">
			<header
				className={cn(
					"flex shrink-0 items-center gap-1.5 border-y border-border/25 bg-foreground/[0.015]",
					isCompact ? "h-6 px-2.5" : "h-7 px-3",
				)}>
				<Activity aria-hidden className="size-3 text-description" strokeWidth={1.75} />
				<h2 className={cn("m-0 font-semibold text-foreground/90", isCompact ? "text-[8.5px]" : "text-[9.5px]")}>
					Execution timeline
				</h2>
			</header>
			<div className="grow flex" ref={scrollContainerRef}>
				<Virtuoso
					aria-busy={showThinkingLoaderRow}
					aria-label="Chronological execution activity"
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
						setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
					}}
					atBottomThreshold={10} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable grow overflow-y-scroll"
					components={virtuosoComponents}
					data={displayedGroupedMessages}
					// increasing top by 3_000 to prevent jumping around when user collapses a row
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
					initialTopMostItemIndex={displayedGroupedMessages.length - 1} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
					itemContent={itemContent}
					key={task.ts}
					rangeChanged={handleRangeChanged}
					ref={virtuosoRef} // anything lower causes issues with followOutput
					role="feed"
					style={{
						scrollbarWidth: "none", // Firefox
						msOverflowStyle: "none", // IE/Edge
						overflowAnchor: "none", // prevent scroll jump when content expands
					}}
				/>
			</div>
		</section>
	)
}
