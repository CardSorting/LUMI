import { ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

interface ThinkingRowProps {
	showTitle: boolean
	reasoningContent?: string
	isVisible: boolean
	isExpanded: boolean
	onToggle?: () => void
	title?: string
	isStreaming?: boolean
	showChevron?: boolean
}

export const ThinkingRow = memo(
	({
		showTitle = false,
		reasoningContent,
		isVisible,
		isExpanded,
		onToggle,
		title = "Working…",
		isStreaming = false,
		showChevron = true,
	}: ThinkingRowProps) => {
		const scrollRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			if (scrollRef.current && isVisible && isExpanded) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight
			}
		}, [isVisible, isExpanded, reasoningContent])

		if (!isVisible) {
			return null
		}

		if (!isExpanded && !showTitle) {
			return null
		}

		return (
			<details className="lumi-inline-disclosure group ml-1 mb-0 -mt-0.5" open={isExpanded}>
				{showTitle ? (
					<summary
						className={cn(
							"lumi-details-trigger list-none flex items-center gap-1 py-0.5 cursor-pointer",
							!onToggle && "cursor-default pointer-events-none",
						)}
						onClick={(e) => {
							if (onToggle) {
								e.preventDefault()
								onToggle()
							}
						}}>
						<span
							className={cn("text-[13px] leading-snug text-description", {
								"animate-shimmer bg-linear-90 from-(--color-lumi) to-foreground bg-[length:200%_100%] bg-clip-text text-transparent":
									isStreaming,
							})}>
							{title}
						</span>
						{showChevron && onToggle ? (
							<ChevronRightIcon
								aria-hidden
								className={cn("size-3 text-description transition-transform", isExpanded && "rotate-90")}
							/>
						) : null}
					</summary>
				) : null}

				{isExpanded && reasoningContent ? (
					<div
						className="max-h-[150px] overflow-y-auto text-description leading-normal whitespace-pre-wrap break-words text-sm pb-2"
						ref={scrollRef}>
						{reasoningContent}
					</div>
				) : null}
			</details>
		)
	},
)

ThinkingRow.displayName = "ThinkingRow"
