import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useMemo } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"
import { findReasoningForApiReq, isTextMessagePendingToolCall, isToolGroup } from "../../utils/messageUtils"
import { ActionButtons } from "../layout/ActionButtons"
import { ToolGroupRenderer } from "./ToolGroupRenderer"

interface MessageRendererProps {
	index: number
	messageOrGroup: DietCodeMessage | DietCodeMessage[]
	groupedMessages: (DietCodeMessage | DietCodeMessage[])[]
	modifiedMessages: DietCodeMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onPendingQuoteChange: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
	footerActive: boolean
	chatState: ChatState
	task: DietCodeMessage
}

/**
 * Specialized component for rendering different message types
 * Handles browser sessions, regular messages, and checkpoint logic
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({
	index,
	messageOrGroup,
	groupedMessages,
	modifiedMessages,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onPendingQuoteChange,
	inputValue,
	messageHandlers,
	footerActive,
	chatState,
	task,
}) => {
	const { mode } = useExtensionState()

	const isLastMessage = useMemo(() => index === groupedMessages?.length - 1, [groupedMessages, index])

	// Get reasoning content and response status for api_req_started messages
	const reasoningData = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "api_req_started") {
			// Use the same message source-of-truth that `groupedMessages` is derived from.
			return findReasoningForApiReq(messageOrGroup.ts, modifiedMessages)
		}
		return { reasoning: undefined, responseStarted: false }
	}, [messageOrGroup, modifiedMessages])

	// Check if a text message is waiting for tool call completion
	const isRequestInProgress = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "text") {
			// Use modifiedMessages so this stays consistent with the rendered list.
			return isTextMessagePendingToolCall(messageOrGroup.ts, modifiedMessages)
		}
		return false
	}, [messageOrGroup, modifiedMessages])

	// Tool group (low-stakes tools grouped together)
	// Determine if this is the last tool group to show active items
	const isLastToolGroup = useMemo(() => {
		if (!isToolGroup(messageOrGroup)) {
			return false
		}
		// Find the last tool group in groupedMessages
		for (let i = groupedMessages.length - 1; i >= 0; i--) {
			if (isToolGroup(groupedMessages[i])) {
				return i === index
			}
		}
		return false
	}, [messageOrGroup, groupedMessages, index])

	const content = (() => {
		if (isToolGroup(messageOrGroup)) {
			return <ToolGroupRenderer allMessages={modifiedMessages} isLastGroup={isLastToolGroup} messages={messageOrGroup} />
		}

		// Browser session group
		if (Array.isArray(messageOrGroup)) {
			return (
				<BrowserSessionRow
					expandedRows={expandedRows}
					isLast={isLastMessage}
					key={messageOrGroup[0]?.ts}
					lastModifiedMessage={modifiedMessages.at(-1)}
					messages={messageOrGroup}
					onHeightChange={onHeightChange}
					onPendingQuoteChange={onPendingQuoteChange}
					onToggleExpand={onToggleExpand}
				/>
			)
		}

		// Regular message
		return (
			<ChatRow
				inputValue={inputValue}
				isExpanded={expandedRows[messageOrGroup.ts] || false}
				isLast={isLastMessage}
				isRequestInProgress={isRequestInProgress}
				key={messageOrGroup.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				message={messageOrGroup}
				mode={mode}
				onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
				onHeightChange={onHeightChange}
				onPendingQuoteChange={onPendingQuoteChange}
				onToggleExpand={onToggleExpand}
				reasoningContent={reasoningData.reasoning}
				responseStarted={reasoningData.responseStarted}
				sendMessageFromChatRow={messageHandlers.handleSendMessage}
			/>
		)
	})()

	return (
		<div
			className={cn({
				"pb-2.5": isLastMessage && !footerActive,
			})}
			data-message-ts={Array.isArray(messageOrGroup) ? messageOrGroup[0]?.ts : messageOrGroup.ts}>
			{content}
			{isLastMessage && (
				<div className="mt-2.5">
					<ActionButtons
						chatState={chatState}
						messageHandlers={messageHandlers}
						messages={modifiedMessages}
						mode={mode}
						task={task}
					/>
				</div>
			)}
		</div>
	)
}

/**
 * Factory function to create the itemContent callback for Virtuoso
 * This allows us to encapsulate the rendering logic while maintaining performance
 */
export const createMessageRenderer = (
	groupedMessages: (DietCodeMessage | DietCodeMessage[])[],
	modifiedMessages: DietCodeMessage[],
	expandedRows: Record<number, boolean>,
	onToggleExpand: (ts: number) => void,
	onHeightChange: (isTaller: boolean) => void,
	onPendingQuoteChange: (quote: string | null) => void,
	inputValue: string,
	messageHandlers: MessageHandlers,
	footerActive: boolean,
	chatState: ChatState,
	task: DietCodeMessage,
) => {
	return (index: number, messageOrGroup: DietCodeMessage | DietCodeMessage[]) => (
		<MessageRenderer
			chatState={chatState}
			expandedRows={expandedRows}
			footerActive={footerActive}
			groupedMessages={groupedMessages}
			index={index}
			inputValue={inputValue}
			messageHandlers={messageHandlers}
			messageOrGroup={messageOrGroup}
			modifiedMessages={modifiedMessages}
			onHeightChange={onHeightChange}
			onPendingQuoteChange={onPendingQuoteChange}
			onToggleExpand={onToggleExpand}
			task={task}
		/>
	)
}
