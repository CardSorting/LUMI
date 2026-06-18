import { memo } from "react"
import { cn } from "@/lib/utils"

interface ExpandHandleProps {
	isExpanded: boolean
	onToggle: () => void
	className?: string
}

/** Inline show more/less — no floating notch overlay. */
const ExpandHandle = memo(({ isExpanded, onToggle, className }: ExpandHandleProps) => {
	return (
		<button
			className={cn(
				"w-full py-1 text-[10px] text-center text-muted-foreground",
				"hover:text-foreground border-t border-editor-group-border/50 bg-code",
				"cursor-pointer bg-transparent",
				className,
			)}
			onClick={onToggle}
			type="button">
			{isExpanded ? "Show less" : "Show more"}
		</button>
	)
})

export default ExpandHandle
