import type { DietCodeMessage } from "@shared/ExtensionMessage"
import React, { useMemo } from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { QuoteSelectionBar } from "@/components/chat/QuoteSelectionBar"
import { isChatInputEnabled } from "../../shared/chatInputPolicy"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	messages: DietCodeMessage[]
	taskSessionActive: boolean
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	messages,
	taskSessionActive,
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		pendingQuote,
		setPendingQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		dietcodeAsk,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
	} = chatState

	const sendRouteOptions = useMemo(() => ({ taskSessionActive }), [taskSessionActive])

	const inputEnabled = useMemo(
		() => isChatInputEnabled(messages, dietcodeAsk, { sendingDisabled }, sendRouteOptions),
		[messages, dietcodeAsk, sendingDisabled, sendRouteOptions],
	)

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior

	return (
		<>
			{pendingQuote && !activeQuote && (
				<div className="mx-2.5 mb-1">
					<QuoteSelectionBar
						onQuote={() => {
							setActiveQuote(pendingQuote)
							setPendingQuote(null)
							window.getSelection()?.removeAllRanges()
						}}
					/>
				</div>
			)}
			{activeQuote && (
				<QuotedMessagePreview isFocused={isTextAreaFocused} onDismiss={() => setActiveQuote(null)} text={activeQuote} />
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				inputValue={inputValue}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={(value) => messageHandlers.handleSendMessage(value || inputValue, selectedImages, selectedFiles)}
				placeholderText={placeholderText}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={!inputEnabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
