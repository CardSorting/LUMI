import { Reply, X } from "lucide-react"
import type React from "react"
import { cn } from "@/lib/utils"

interface QuotedMessagePreviewProps {
	text: string
	onDismiss: () => void
	isFocused?: boolean
}

/** Inline reply preview above the input — no floating layer. */
const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({ text, onDismiss, isFocused }) => {
	return (
		<div
			className={cn(
				"mx-2.5 mb-1 flex items-start gap-1.5 rounded-lg border px-2 py-1.5",
				"border-border/30 bg-[color-mix(in_srgb,var(--vscode-input-background)_85%,var(--vscode-toolbar-hoverBackground))]",
				isFocused && "border-[color-mix(in_srgb,var(--vscode-focusBorder)_40%,var(--vscode-input-border))]",
			)}>
			<Reply aria-hidden className="size-3 shrink-0 mt-0.5 text-muted-foreground" strokeWidth={2} />
			<p className="flex-1 min-w-0 m-0 text-xs leading-snug line-clamp-2 text-foreground/90 ph-no-capture" title={text}>
				{text}
			</p>
			<button
				aria-label="Remove quoted message"
				className="shrink-0 p-0.5 rounded hover:bg-accent/20 text-muted-foreground hover:text-foreground border-0 bg-transparent cursor-pointer"
				onClick={onDismiss}
				type="button">
				<X aria-hidden className="size-3.5" strokeWidth={2} />
			</button>
		</div>
	)
}

export default QuotedMessagePreview
