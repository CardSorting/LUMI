import { DietCodeMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/dietcode/common"
import { NewTaskRequest } from "@shared/proto/dietcode/task"
import { Mode } from "@shared/storage/types"
import { Braces, Bug, Flag, Layers, Sparkles } from "lucide-react"
import React, { useCallback, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { ChatState, MessageHandlers, ScrollBehavior, WelcomeSectionProps } from "../../types/chatTypes"
import { InputSection } from "./InputSection"

interface RedesignedWelcomeSectionProps extends WelcomeSectionProps {
	chatState?: ChatState
	messageHandlers?: MessageHandlers
	messages?: DietCodeMessage[]
	mode?: Mode
	placeholderText?: string
	shouldDisableFilesAndImages?: boolean
	selectFilesAndImages?: () => Promise<void>
	taskSessionActive?: boolean
}

const formatRelativeTime = (ts: number) => {
	const now = Date.now()
	const diff = now - ts
	const sec = Math.floor(diff / 1000)
	const min = Math.floor(sec / 60)
	const hr = Math.floor(min / 60)
	const day = Math.floor(hr / 24)

	if (sec < 60) return "Just now"
	if (min < 60) return `${min}m ago`
	if (hr < 24) return `${hr}h ago`
	if (day === 1) return "Yesterday"
	return `${day}d ago`
}

export const WelcomeSection: React.FC<RedesignedWelcomeSectionProps> = ({
	showHistoryView,
	chatState,
	messageHandlers,
	messages,
	mode,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	taskSessionActive,
}) => {
	const { taskHistory } = useExtensionState()

	const recentChats = useMemo(() => {
		return [...taskHistory]
			.filter((item) => item.ts && item.task)
			.sort((a, b) => b.ts - a.ts)
			.slice(0, 2)
	}, [taskHistory])

	const handleOpenTask = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error opening task:", error),
		)
	}, [])

	const handleStartPrompt = useCallback(async (prompt: string) => {
		try {
			await TaskServiceClient.newTask(
				NewTaskRequest.create({
					text: prompt,
					images: [],
					files: [],
				}),
			)
		} catch (error) {
			console.error("Failed to start task:", error)
		}
	}, [])

	const primaryCards = [
		{
			id: "explain",
			title: "Explain codebase",
			description: "Understand the project and provide clear explanations.",
			icon: Braces,
			prompt: "Look through this workspace and explain what this project does in plain language. Summarize the main parts and how they fit together.",
			color: "text-blue-400 bg-blue-500/10",
		},
		{
			id: "fix",
			title: "Fix a bug",
			description: "Investigate issues and propose reliable fixes.",
			icon: Bug,
			prompt: "I'd like help fixing an issue in this project. Ask me what isn't working, then investigate and walk me through a fix.",
			color: "text-red-400 bg-red-500/10",
		},
		{
			id: "plan",
			title: "Plan a feature",
			description: "Break an idea into implementation steps.",
			icon: Flag,
			prompt: "I want to add a feature to this project. Ask what I have in mind, then help me plan and implement it step by step.",
			color: "text-green-400 bg-green-500/10",
		},
		{
			id: "review",
			title: "Review architecture",
			description: "Evaluate design decisions and scalability.",
			icon: Layers,
			prompt: "Perform an architectural review of this codebase. Evaluate the design decisions, patterns used, and overall code quality.",
			color: "text-indigo-400 bg-indigo-500/10",
		},
	]

	return (
		<div className="flex-1 overflow-y-auto px-4 py-2 md:px-6 max-w-[1000px] mx-auto w-full select-none flex flex-col justify-between">
			<div>
				{/* Welcome Hero Area */}
				<div className="flex items-center gap-1.5 mt-1 mb-2.5 justify-center">
					<Sparkles className="size-4 text-lumi-lavender animate-pulse" />
					<h1 className="text-xs font-bold tracking-tight text-[#faf9f7] leading-tight font-mono">
						How can I help you build today?
					</h1>
				</div>

				{/* Primary Task Cards - Horizontal Chips */}
				<div className="flex gap-2 justify-center mb-3 overflow-x-auto py-1 w-full scrollbar-none">
					{primaryCards.map((card) => {
						const IconComp = card.icon
						return (
							<button
								className="flex items-center gap-1.5 rounded-lg bg-[#1a1a22] border border-[#20202a] py-1.5 px-3 hover:border-lumi hover:bg-[#20202a]/60 text-xs font-medium transition-all active:scale-[0.98] shrink-0"
								key={card.id}
								onClick={() => handleStartPrompt(card.prompt)}
								type="button">
								<IconComp className="size-3.5 text-lumi-lavender" />
								<span>{card.title.split(" ")[0]}</span>
							</button>
						)
					})}
				</div>

				{/* Recent-chat section */}
				{recentChats.length > 0 && (
					<div className="mb-3">
						<div className="flex items-center justify-between mb-1.5">
							<h2 className="text-[11px] font-bold text-[#faf9f7] uppercase tracking-wider opacity-50">Recent</h2>
							<button
								className="text-[10px] text-lumi hover:text-lumi-lavender transition-colors font-semibold"
								onClick={showHistoryView}
								type="button">
								All
							</button>
						</div>

						<div className="space-y-1">
							{recentChats.slice(0, 1).map((item) => {
								const title = item.task.split("\n")[0] || ""
								return (
									<div
										className="flex items-center justify-between gap-2 rounded-xl bg-[#1a1a22] border border-[#20202a]/60 px-3 py-2 cursor-pointer hover:bg-[#20202a]/40 hover:border-lumi/30 transition-all text-xs"
										key={item.id}
										onClick={() => handleOpenTask(item.id)}>
										<span className="truncate text-[#faf9f7] font-semibold flex-1 pr-4">{title}</span>
										<span className="text-[9px] text-[#8a8996]/45 shrink-0">
											{formatRelativeTime(item.ts)}
										</span>
									</div>
								)
							})}
						</div>
					</div>
				)}
			</div>

			{/* Inline Composer & status bar at the bottom of the welcome page */}
			{chatState && messageHandlers && messages && mode && placeholderText && (
				<div className="mt-auto pt-2.5 border-t border-[#20202a]/60">
					{/* Textarea */}
					<InputSection
						chatState={chatState}
						messageHandlers={messageHandlers}
						messages={messages}
						placeholderText={placeholderText}
						scrollBehavior={{ isAtBottom: true, scrollToBottomAuto: () => {} } as unknown as ScrollBehavior}
						selectFilesAndImages={selectFilesAndImages ?? (async () => {})}
						shouldDisableFilesAndImages={shouldDisableFilesAndImages ?? false}
						taskSessionActive={taskSessionActive ?? false}
					/>
				</div>
			)}
		</div>
	)
}
