import { AtSign, Paperclip } from "lucide-react"
import { memo } from "react"
import type { ComposerMode } from "./chat-view/shared/composerState"

interface ChatInputActionsProps {
	onContextClick: () => void
	onAttachClick: () => void
	attachDisabled: boolean
	modelDisplayName: string
	onModelClick: () => void
	composerMode: ComposerMode
}

const ACTION_CLASS =
	"lumi-icon-action flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-description transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"

/** Composer utilities share one bottom-aligned control row with the send action. */
export const ChatInputActions = memo(
	({ onContextClick, onAttachClick, attachDisabled, modelDisplayName, onModelClick, composerMode }: ChatInputActionsProps) => (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<button
				aria-label="Mention workspace context"
				className={ACTION_CLASS}
				data-testid="context-button"
				onClick={onContextClick}
				title="Mention workspace context"
				type="button">
				<AtSign aria-hidden className="size-3.5" strokeWidth={1.75} />
			</button>

			<button
				aria-label="Attach a file or image"
				className={ACTION_CLASS}
				data-testid="files-button"
				disabled={attachDisabled}
				onClick={onAttachClick}
				title={attachDisabled ? "Attachment limit reached" : "Attach a file or image"}
				type="button">
				<Paperclip aria-hidden className="size-3.5" strokeWidth={1.75} />
			</button>

			<button
				aria-label={`Change model. Current model: ${modelDisplayName}`}
				className="lumi-composer-model ml-0.5 min-w-0 max-w-full truncate rounded-md border-0 bg-transparent px-2 py-1 text-left text-[9px] text-description transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={onModelClick}
				title={`Change model · ${modelDisplayName}`}
				type="button">
				{modelDisplayName}
			</button>
			{composerMode === "steering" ? (
				<span className="hidden shrink-0 items-center gap-1 text-[8px] text-description/65 min-[420px]:inline-flex">
					<span aria-hidden className="size-1.5 rounded-full bg-link" />
					Steer
				</span>
			) : null}
		</div>
	),
)

ChatInputActions.displayName = "ChatInputActions"
