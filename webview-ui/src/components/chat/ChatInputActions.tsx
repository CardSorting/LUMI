import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AtSign, Paperclip } from "lucide-react"
import { memo } from "react"

interface ChatInputActionsProps {
	onContextClick: () => void
	onAttachClick: () => void
	attachDisabled: boolean
	modelDisplayName: string
	onModelClick: () => void
}

/**
 * Minimal input row — @ attach model only; slash commands for power features.
 */
export const ChatInputActions = memo(
	({ onContextClick, onAttachClick, attachDisabled, modelDisplayName, onModelClick }: ChatInputActionsProps) => {
		return (
			<div className="flex items-center w-full h-4 gap-0.5 min-w-0">
				<VSCodeButton
					appearance="icon"
					aria-label="Mention a file"
					className="p-0 m-0 shrink-0"
					data-testid="context-button"
					onClick={onContextClick}>
					<AtSign className="size-3 opacity-80" strokeWidth={2} />
				</VSCodeButton>

				<VSCodeButton
					appearance="icon"
					aria-label="Attach file"
					className="p-0 m-0 shrink-0"
					data-testid="files-button"
					disabled={attachDisabled}
					onClick={onAttachClick}>
					<Paperclip className="size-3 opacity-80" strokeWidth={2} />
				</VSCodeButton>

				<button
					className="flex-1 min-w-0 text-left text-[10px] text-muted-foreground truncate px-1 hover:text-foreground bg-transparent border-0 cursor-pointer"
					onClick={onModelClick}
					title="Change model"
					type="button">
					{modelDisplayName}
				</button>
				<span className="text-[9px] text-muted-foreground/70 shrink-0 whitespace-nowrap">Enter ↵</span>
			</div>
		)
	},
)

ChatInputActions.displayName = "ChatInputActions"
