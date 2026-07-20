import { AtSign, ChevronDown, Paperclip } from "lucide-react"
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
	"lumi-icon-action flex size-7 shrink-0 items-center justify-center rounded-lg border border-[#272730] bg-[#1a1a22] text-[#faf9f7]/70 transition-colors hover:bg-[#20202a]/60 hover:text-[#faf9f7] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lumi disabled:cursor-not-allowed disabled:opacity-40"

/** Composer utilities share one bottom-aligned control row with the send action. */
export const ChatInputActions = memo(
	({ onContextClick, onAttachClick, attachDisabled, modelDisplayName, onModelClick, composerMode }: ChatInputActionsProps) => (
		<div className="flex min-w-0 flex-1 items-center gap-1.5 select-none">
			<button
				aria-label="Mention workspace context"
				className={ACTION_CLASS}
				data-testid="context-button"
				onClick={onContextClick}
				title="Mention workspace context"
				type="button">
				<AtSign aria-hidden className="size-3.5" strokeWidth={2} />
			</button>

			<button
				aria-label="Attach a file or image"
				className={ACTION_CLASS}
				data-testid="files-button"
				disabled={attachDisabled}
				onClick={onAttachClick}
				title={attachDisabled ? "Attachment limit reached" : "Attach a file or image"}
				type="button">
				<Paperclip aria-hidden className="size-3.5" strokeWidth={2} />
			</button>

			<button
				aria-label={`Change model. Current model: ${modelDisplayName}`}
				className="lumi-composer-model flex items-center justify-between gap-1.5 ml-1 min-w-0 max-w-full truncate rounded-lg border border-[#272730] bg-[#1a1a22] px-2.5 py-1 text-left text-[11px] font-semibold text-[#faf9f7]/70 transition-colors hover:bg-[#20202a]/60 hover:border-lumi/50 hover:text-[#faf9f7] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lumi"
				onClick={onModelClick}
				title={`Change model · ${modelDisplayName}`}
				type="button">
				<span className="truncate">{modelDisplayName}</span>
				<ChevronDown className="size-3 text-description/50 shrink-0" />
			</button>
			{composerMode === "steering" ? (
				<span className="hidden shrink-0 items-center gap-1 text-[9px] text-[#faf9f7]/60 min-[420px]:inline-flex bg-lumi/20 border border-lumi/30 px-1.5 py-0.5 rounded">
					<span aria-hidden className="size-1.5 rounded-full bg-lumi animate-pulse" />
					Steer
				</span>
			) : null}
		</div>
	),
)

ChatInputActions.displayName = "ChatInputActions"
