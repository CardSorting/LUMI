import { AlertCircle } from "lucide-react"
import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface NewChatConfirmModalProps {
	isOpen: boolean
	onConfirm: () => void
	onCancel: () => void
	isPending?: boolean
	error?: string | null
}

/** Confirmation that preserves focus, traps keyboard navigation, and restores focus on close. */
export const NewChatConfirmModal = ({ isOpen, onConfirm, onCancel, isPending = false, error }: NewChatConfirmModalProps) => {
	const cancelRef = useRef<HTMLButtonElement>(null)

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open && !isPending) onCancel()
			}}
			open={isOpen}>
			<DialogContent
				aria-describedby="new-chat-confirm-description"
				className="top-1/2 w-[calc(100%-2rem)] max-w-sm translate-y-[-50%] gap-0 border-menu-border bg-menu p-4 text-foreground"
				hideClose
				onEscapeKeyDown={(event) => {
					if (isPending) event.preventDefault()
				}}
				onInteractOutside={(event) => {
					if (isPending) event.preventDefault()
				}}
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					requestAnimationFrame(() => cancelRef.current?.focus())
				}}>
				<DialogHeader className="text-left">
					<DialogTitle className="text-sm font-semibold leading-tight">Start a new chat?</DialogTitle>
					<DialogDescription
						className="mt-2 text-[11px] leading-relaxed text-description"
						id="new-chat-confirm-description">
						This ends the current session and opens a blank chat. You can return to this conversation from Past chats.
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<div
						className="mt-3 flex items-start gap-2 rounded border border-error/40 bg-error/10 px-2.5 py-2 text-[11px] leading-snug text-foreground"
						role="alert">
						<AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-error" />
						<span>{error}</span>
					</div>
				) : null}

				<DialogFooter className="mt-4 flex-row justify-end gap-2 space-x-0">
					<Button
						className="h-8 rounded px-3 text-[11px]"
						disabled={isPending}
						onClick={onCancel}
						ref={cancelRef}
						variant="outline">
						Keep current chat
					</Button>
					<Button className="h-8 rounded px-3 text-[11px]" disabled={isPending} onClick={onConfirm}>
						{isPending ? "Starting…" : "Start new chat"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
