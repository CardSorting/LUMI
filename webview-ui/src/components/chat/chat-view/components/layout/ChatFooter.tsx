import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import AutoApproveBar from "@/components/chat/auto-approve-menu/AutoApproveBar"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { ActionButtons } from "./ActionButtons"
import { InputSection } from "./InputSection"
import { ScrollToBottomBar } from "./ScrollToBottomBar"

interface ChatFooterProps {
	showHistory: boolean
	task?: DietCodeMessage
	isNewUser: boolean
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
	messages: DietCodeMessage[]
	mode: Mode
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	taskSessionActive: boolean
}

/** Bottom-anchored footer — input, suggestions, and inline controls (no overlays). */
export const ChatFooter = ({
	showHistory,
	task,
	isNewUser,
	scrollBehavior,
	chatState,
	messageHandlers,
	messages,
	mode,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	taskSessionActive,
}: ChatFooterProps) => {
	if (showHistory) {
		return null
	}

	return (
		<footer className="bg-background border-t border-border/40 shadow-[0_-8px_24px_rgba(0,0,0,0.035)] shrink-0">
			{!task && !isNewUser && <SuggestedTasks compact />}
			{task && scrollBehavior.showScrollToBottom && (
				<ScrollToBottomBar
					onClick={() => {
						scrollBehavior.scrollToBottomSmooth()
						scrollBehavior.disableAutoScrollRef.current = false
					}}
				/>
			)}
			<ActionButtons chatState={chatState} messageHandlers={messageHandlers} messages={messages} mode={mode} task={task} />
			<AutoApproveBar />
			<InputSection
				chatState={chatState}
				messageHandlers={messageHandlers}
				messages={messages}
				placeholderText={placeholderText}
				scrollBehavior={scrollBehavior}
				selectFilesAndImages={selectFilesAndImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
				taskSessionActive={taskSessionActive}
			/>
		</footer>
	)
}
