import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { StringRequest } from "@shared/proto/dietcode/common"
import { ChevronRight } from "lucide-react"
import React, { memo, useCallback, useMemo } from "react"
import ChecklistRenderer from "@/components/common/ChecklistRenderer"
import LightMarkdown from "@/components/common/LightMarkdown"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface TodoInfo {
	readonly currentTodo: { text: string; completed: boolean; index: number } | null
	readonly currentIndex: number
	readonly completedCount: number
	readonly totalCount: number
	readonly progressPercentage: number
}

interface FocusChainProps {
	readonly lastProgressMessageText?: string
	readonly currentTaskItemId?: string
	readonly showPlaceholderWhenEmpty?: boolean
}

const COMPLETED_MESSAGE = "All steps done!"
const TODO_LIST_LABEL = "Steps"
const NEW_STEPS_MESSAGE = "More steps may appear as we go."

const StepsSummary = memo<{ todoInfo: TodoInfo }>(({ todoInfo }) => {
	const { currentTodo, currentIndex, totalCount, completedCount, progressPercentage } = todoInfo
	const isCompleted = completedCount === totalCount
	const displayText = isCompleted ? COMPLETED_MESSAGE : currentTodo?.text || TODO_LIST_LABEL

	return (
		<div className={cn("relative w-full", isCompleted && "text-success")}>
			<div
				aria-hidden
				className={cn(
					"absolute bottom-0 left-0 h-0.5 bg-success transition-[width] duration-300 pointer-events-none",
					progressPercentage === 0 || progressPercentage === 100 ? "opacity-0" : "opacity-100",
				)}
				style={{ width: `${progressPercentage}%` }}
			/>
			<div className="flex items-center gap-2 py-1.5 px-2">
				<span
					className={cn(
						"rounded-md px-1.5 py-0.5 text-[11px] shrink-0 bg-badge-foreground/20",
						isCompleted && "bg-success text-black",
					)}>
					{currentIndex}/{totalCount}
				</span>
				<span className="flex-1 min-w-0 truncate text-[11px] font-medium">
					<LightMarkdown compact text={displayText} />
				</span>
				<ChevronRight
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</div>
		</div>
	)
})
StepsSummary.displayName = "StepsSummary"

const todoInfoCache = new Map<string, TodoInfo | null>()
const MAX_CACHE_SIZE = 100

const parseCurrentTodoInfo = (text: string): TodoInfo | null => {
	if (!text) return null
	const cached = todoInfoCache.get(text)
	if (cached !== undefined) return cached

	let completedCount = 0
	let totalCount = 0
	let firstIncompleteIndex = -1
	let firstIncompleteText: string | null = null
	let lineStart = 0
	let lineEnd = text.indexOf("\n")

	while (lineStart < text.length) {
		const line = lineEnd === -1 ? text.substring(lineStart).trim() : text.substring(lineStart, lineEnd).trim()
		if (isFocusChainItem(line)) {
			const isCompleted = isCompletedFocusChainItem(line)
			if (isCompleted) {
				completedCount++
			} else if (firstIncompleteIndex === -1) {
				firstIncompleteIndex = totalCount
				firstIncompleteText = line.substring(5).trim()
			}
			totalCount++
		}
		if (lineEnd === -1) break
		lineStart = lineEnd + 1
		lineEnd = text.indexOf("\n", lineStart)
	}

	if (totalCount === 0) {
		todoInfoCache.set(text, null)
		return null
	}

	const result: TodoInfo = {
		currentTodo: firstIncompleteText ? { text: firstIncompleteText, completed: false, index: firstIncompleteIndex } : null,
		currentIndex: firstIncompleteIndex >= 0 ? firstIncompleteIndex + 1 : totalCount,
		completedCount,
		totalCount,
		progressPercentage: (completedCount / totalCount) * 100,
	}

	if (todoInfoCache.size >= MAX_CACHE_SIZE) {
		const firstKey = todoInfoCache.keys().next().value
		if (firstKey) todoInfoCache.delete(firstKey)
	}
	todoInfoCache.set(text, result)
	return result
}

/** Task progress steps — native <details>, no overlay. */
export const FocusChain: React.FC<FocusChainProps> = memo(
	({ currentTaskItemId, lastProgressMessageText, showPlaceholderWhenEmpty }) => {
		const todoInfo = useMemo(
			() => (lastProgressMessageText ? parseCurrentTodoInfo(lastProgressMessageText) : null),
			[lastProgressMessageText],
		)

		const handleEditClick = useCallback(
			(e: React.MouseEvent) => {
				e.preventDefault()
				if (currentTaskItemId) {
					FileServiceClient.openFocusChainFile(StringRequest.create({ value: currentTaskItemId }))
				}
			},
			[currentTaskItemId],
		)

		if (!todoInfo) {
			if (!showPlaceholderWhenEmpty) return null
			return (
				<div aria-hidden className="rounded-sm bg-toolbar-hover/50 flex items-center gap-2 px-2 py-1.5 opacity-70">
					<span className="rounded-md px-1.5 py-0.5 text-[11px] bg-badge-foreground/20">0/0</span>
					<span className="text-[11px] text-muted-foreground truncate">Steps</span>
				</div>
			)
		}

		const isCompleted = todoInfo.completedCount === todoInfo.totalCount

		return (
			<details className="lumi-inline-disclosure rounded-sm bg-toolbar-hover/50 group">
				<summary className="lumi-details-trigger list-none cursor-pointer" title="View or edit steps">
					<StepsSummary todoInfo={todoInfo} />
				</summary>
				<div className="px-2 pb-2 pt-0.5 border-t border-border/15">
					<button
						className="w-full text-left bg-transparent border-0 p-0 cursor-pointer"
						onClick={handleEditClick}
						title="Open steps file"
						type="button">
						<ChecklistRenderer text={lastProgressMessageText!} />
					</button>
					{isCompleted ? <p className="mt-1.5 mb-0 text-[10px] text-muted-foreground">{NEW_STEPS_MESSAGE}</p> : null}
				</div>
			</details>
		)
	},
	(prev, next) =>
		prev.lastProgressMessageText === next.lastProgressMessageText &&
		prev.currentTaskItemId === next.currentTaskItemId &&
		prev.showPlaceholderWhenEmpty === next.showPlaceholderWhenEmpty,
)

FocusChain.displayName = "FocusChain"
