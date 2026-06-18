import { ChevronDown } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"

interface ScrollToBottomBarProps {
	onClick: () => void
}

/** Inline footer bar — replaces floating scroll FAB over messages. */
export const ScrollToBottomBar = memo(({ onClick }: ScrollToBottomBarProps) => (
	<button
		className={cn(
			"w-full flex items-center justify-center gap-1 py-1.5 text-[11px]",
			"text-muted-foreground border-b border-border/20",
			"hover:text-foreground hover:bg-accent/10",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
		)}
		onClick={onClick}
		type="button">
		<ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />
		Jump to latest
	</button>
))

ScrollToBottomBar.displayName = "ScrollToBottomBar"
