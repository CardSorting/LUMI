import { Reply } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"

interface QuoteSelectionBarProps {
	onQuote: () => void
	className?: string
}

/** Inline reply-to-selection — no floating overlay in narrow sidebars. */
export const QuoteSelectionBar = memo(({ onQuote, className }: QuoteSelectionBarProps) => (
	<div
		className={cn(
			"quote-selection-bar flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-border/30",
			className,
		)}>
		<span className="text-[10px] text-muted-foreground truncate">Selected text</span>
		<button
			className="inline-flex items-center gap-1 text-[10px] text-link bg-transparent border-0 p-0 cursor-pointer hover:underline shrink-0"
			onClick={(e) => {
				e.stopPropagation()
				onQuote()
			}}
			type="button">
			<Reply aria-hidden className="size-3" strokeWidth={2} />
			Add to reply
		</button>
	</div>
))

QuoteSelectionBar.displayName = "QuoteSelectionBar"
