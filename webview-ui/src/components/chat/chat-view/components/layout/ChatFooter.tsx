import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { Bug, Flag, Layers, Sparkles } from "lucide-react"
import { useCallback } from "react"

import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
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
	const quickChips = [
		{
			label: "Explain project",
			icon: Sparkles,
			prompt: "Look through this workspace and explain what this project does in plain language. Summarize the main parts and how they fit together.",
		},
		{
			label: "Fix a problem",
			icon: Bug,
			prompt: "I'd like help fixing an issue in this project. Ask me what isn't working, then investigate and walk me through a fix.",
		},
		{
			label: "Add a feature",
			icon: Flag,
			prompt: "I want to add a feature to this project. Ask what I have in mind, then help me plan and implement it step by step.",
		},
		{
			label: "Review code",
			icon: Layers,
			prompt: "Perform a code review of the files in this workspace. Identify any code patterns, styling improvements, or potential errors.",
		},
	]

	const handleChipClick = useCallback(
		(prompt: string) => {
			chatState.setInputValue(prompt)
			setTimeout(() => {
				chatState.textAreaRef.current?.focus()
			}, 50)
		},
		[chatState],
	)

	if (showHistory || !task) {
		return null
	}

	return (
		<footer className="bg-[#16161d] border-t border-[#20202a] shrink-0 w-full flex flex-col relative select-none">
			{/* Quick Action Chips (Welcome mode only) */}
			{!task && !isNewUser && (
				<div className="flex gap-2 items-center justify-center py-3.5 px-4 overflow-x-auto border-b border-[#20202a] w-full">
					{quickChips.map((chip, idx) => {
						const IconComp = chip.icon
						return (
							<button
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#272730] bg-[#1a1a22] text-[#faf9f7] hover:border-lumi hover:bg-[#20202a]/60 text-xs font-medium transition-all active:scale-[0.98] shrink-0"
								key={idx}
								onClick={() => handleChipClick(chip.prompt)}
								type="button">
								<IconComp className="size-3.5 text-lumi-lavender" />
								{chip.label}
							</button>
						)
					})}
				</div>
			)}

			{task && scrollBehavior.showScrollToBottom && (
				<ScrollToBottomBar
					onClick={() => {
						scrollBehavior.scrollToBottomSmooth()
						scrollBehavior.disableAutoScrollRef.current = false
					}}
				/>
			)}

			{/* Input Form Section */}
			<div className="p-4 w-full">
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
			</div>
		</footer>
	)
}
