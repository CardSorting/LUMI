import { NewTaskRequest } from "@shared/proto/dietcode/task"
import React, { useCallback } from "react"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { quickWinTasks } from "./quickWinTasks"

interface SuggestedTasksProps {
	/** When true, renders above the input in the footer (ChatGPT-style). */
	compact?: boolean
}

/**
 * Horizontal suggestion chips — inline, one tap to start.
 * In compact mode sits directly above the message input on the welcome screen.
 */
export const SuggestedTasks: React.FC<SuggestedTasksProps> = ({ compact = false }) => {
	const handleSuggestionClick = useCallback(async (prompt: string) => {
		try {
			await TaskServiceClient.newTask(
				NewTaskRequest.create({
					text: prompt,
					images: [],
					files: [],
				}),
			)
		} catch (error) {
			console.error("Failed to start suggested task:", error)
		}
	}, [])

	return (
		<section aria-label="Suggested prompts" className={cn(compact ? "pt-2 pb-1 border-b border-border/15" : "pb-2")}>
			{!compact && <p className="text-[11px] font-medium text-muted-foreground m-0 mb-2 px-3">Try asking</p>}
			<div className={cn("flex gap-1.5 overflow-x-auto pb-0.5 lumi-scroll-chips", compact ? "px-2" : "px-3 pb-1")}>
				{(compact ? quickWinTasks.slice(0, 3) : quickWinTasks).map((task) => (
					<button
						className={cn(
							"shrink-0 max-w-[180px] px-2.5 py-1 rounded-full text-[11px] font-medium",
							"border border-border/50 text-foreground",
							"bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_40%,transparent)]",
							"hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_75%,transparent)]",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							"truncate",
						)}
						key={task.id}
						onClick={() => handleSuggestionClick(task.prompt)}
						title={task.description}
						type="button">
						{task.title}
					</button>
				))}
			</div>
		</section>
	)
}
