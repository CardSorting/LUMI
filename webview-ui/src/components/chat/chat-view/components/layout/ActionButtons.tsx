import { isApiRequestInProgress } from "@shared/agentActivity"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { CheckCircle2, ChevronDown, CircleAlert, File, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useIsCompact } from "@/context/DensityContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { getActionPresentation, resolveActionShortcut } from "../../shared/actionPresentation"
import { type ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: DietCodeMessage
	messages: DietCodeMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
}

const RISK_TONE = {
	low: "border-success/25 bg-success/[0.05] text-success",
	medium: "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
	high: "border-error/30 bg-error/[0.06] text-error",
} as const

/** High-confidence approval, recovery, completion, and stop controls. */
export const ActionButtons: React.FC<ActionButtonsProps> = ({ task, messages, chatState, mode, messageHandlers }) => {
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled } = chatState
	const { enableCheckpointsSetting, checkpointManagerErrorMessage, taskLifecycleEvent } = useExtensionState()
	const [isProcessing, setIsProcessing] = useState(false)
	const panelRef = useRef<HTMLElement>(null)

	const [lastMessage, secondLastMessage] = useMemo(() => {
		const len = messages.length
		return len > 0 ? [messages[len - 1], messages[len - 2]] : [undefined, undefined]
	}, [messages])

	const buttonConfig = useMemo(
		() => (lastMessage ? getButtonConfig(lastMessage, mode) : { sendingDisabled: false, enableButtons: false }),
		[lastMessage, mode],
	)
	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = Boolean(primaryText || secondaryText)
	const completionAction =
		lastMessage?.type === "ask" && (lastMessage.ask === "completion_result" || lastMessage.ask === "resume_completed_task")
	const lifecycleCompleted =
		taskLifecycleEvent?.committed.state === "terminal" && taskLifecycleEvent.committed.terminalOutcome === "completed"
	const canInteract = enableButtons && !isProcessing && (!completionAction || lifecycleCompleted)
	const executionControlConfigured = secondaryAction === "cancel" && !primaryAction
	const isExecutionControl = Boolean(executionControlConfigured && lastMessage && isApiRequestInProgress(lastMessage))
	const checkpointAvailable = enableCheckpointsSetting !== false && !checkpointManagerErrorMessage
	const presentation = useMemo(
		() => getActionPresentation(lastMessage, buttonConfig, { checkpointAvailable, lifecycleCompleted }),
		[lastMessage, buttonConfig, checkpointAvailable, lifecycleCompleted],
	)

	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		setIsProcessing(false)
	}, [buttonConfig, setSendingDisabled])

	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage?.type, lastMessage?.say, secondLastMessage?.ask, chatState])

	const handleActionClick = useCallback(
		(action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (isProcessing) return
			setIsProcessing(true)

			void messageHandlers.executeButtonAction(action, text, images, files).catch(() => setIsProcessing(false))
		},
		[messageHandlers, isProcessing],
	)

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (!canInteract || event.defaultPrevented || event.isComposing) return

			const action = resolveActionShortcut({
				key: event.key,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				isPanelFocused: Boolean(panelRef.current?.contains(document.activeElement)),
				isExecutionControl,
				isApproval: presentation.kind === "approval",
				isDestructive: presentation.isDestructive,
				primaryAction,
				secondaryAction,
			})

			if (!action) return
			event.preventDefault()
			event.stopPropagation()
			handleActionClick(action, inputValue, selectedImages, selectedFiles)
		},
		[
			canInteract,
			handleActionClick,
			inputValue,
			isExecutionControl,
			presentation.isDestructive,
			presentation.kind,
			primaryAction,
			secondaryAction,
			selectedFiles,
			selectedImages,
		],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	const isCompact = useIsCompact()

	const isMac = useMemo(() => typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent), [])

	const resourceDisplay = useMemo(() => {
		if (!presentation.resource) return null
		return (
			<code className="min-w-0 truncate bg-transparent font-mono text-[9px]" title={presentation.resource}>
				{presentation.resource}
			</code>
		)
	}, [presentation.resource])

	if (!task || !hasButtons || (executionControlConfigured && !isExecutionControl)) return null

	const opacity = canInteract || task.partial === true ? 1 : 0.62
	const detailId = `lumi-action-detail-${lastMessage?.ts ?? "current"}`

	if (isExecutionControl && secondaryText && secondaryAction) {
		return (
			<fieldset
				aria-label="Execution controls"
				className="m-0 flex items-center justify-between gap-2 border-0 px-2 pb-1.5 animate-pulse"
				style={{ opacity }}>
				<div className="flex min-w-0 items-center gap-1.5 text-[9px] text-description font-medium">
					<LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" strokeWidth={2} />
					<span className="truncate">Execution active</span>
					{!isCompact && (
						<kbd className="rounded border border-border/60 px-1 py-0.5 font-sans text-[8px] text-description">
							Esc
						</kbd>
					)}
				</div>
				<Button
					aria-keyshortcuts="Escape"
					className={cn("shrink-0 rounded border-error/30 px-2 text-[10px] text-error hover:bg-error/[0.06] h-6")}
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}
					variant="outline">
					Stop execution
				</Button>
			</fieldset>
		)
	}

	const sectionLabel =
		presentation.kind === "recovery"
			? "Something went wrong"
			: presentation.kind === "completion"
				? "Task completed"
				: presentation.kind === "other"
					? "Task state pending"
					: "Needs your approval"
	const isCompletion = presentation.kind === "completion"
	const isRecovery = presentation.kind === "recovery"
	const panelTone = isRecovery
		? "border-error/30 bg-error/[0.035]"
		: isCompletion
			? "border-success/25 bg-success/[0.025]"
			: presentation.isDestructive
				? "border-error/35 bg-error/[0.035]"
				: "border-amber-500/30 bg-amber-500/[0.035]"

	const runAction = (action: ButtonActionType) => handleActionClick(action, inputValue, selectedImages, selectedFiles)

	const primaryLabel = presentation.approveLabel ?? primaryText
	const secondaryIsRecommended = presentation.recommendedAction === secondaryAction

	// Compact reversibility signal — short text that always stays visible
	const reversibilitySignal = presentation.isDestructive
		? "Irreversible"
		: presentation.reversibility?.toLowerCase().includes("undo")
			? "Undoable"
			: presentation.reversibility?.toLowerCase().includes("checkpoint")
				? "Checkpoint"
				: "Reversible"

	const buttonHeight = "h-[26px]"

	return (
		<section
			aria-describedby={!isCompletion ? detailId : undefined}
			aria-label={sectionLabel}
			className={cn(
				"mx-2 mb-1.5 overflow-hidden rounded-md border shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:shadow-[0_3px_8px_rgba(0,0,0,0.06)] transition-all duration-300",
				panelTone,
			)}
			ref={panelRef}
			style={{ opacity }}>
			{/* ── Main Flex Row ── */}
			<div
				className={cn(
					"flex items-center justify-between gap-2.5 p-1.5",
					isCompact ? "flex-col items-stretch" : "flex-row",
				)}>
				{/* Left Column: Icon, Title, and Badge */}
				<div className="flex items-center gap-1.5 min-w-0 flex-1">
					{isRecovery ? (
						<CircleAlert aria-hidden className="size-3.5 shrink-0 text-error" strokeWidth={2} />
					) : isCompletion ? (
						<CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-success" strokeWidth={2} />
					) : presentation.isDestructive ? (
						<ShieldAlert aria-hidden className="size-3.5 shrink-0 text-error animate-pulse" strokeWidth={2} />
					) : (
						<ShieldCheck
							aria-hidden
							className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400"
							strokeWidth={2}
						/>
					)}
					<div className="min-w-0 flex-1 flex flex-col justify-center">
						<div className="flex items-center gap-1.5 min-w-0 flex-wrap">
							<span className="font-semibold text-[10.5px] leading-tight text-foreground truncate">
								{presentation.summary}
							</span>
							{!isCompletion && presentation.resource && (
								<>
									<span className="text-description/40 text-[9px]">·</span>
									<code
										className="text-[9px] text-description/70 font-mono truncate"
										title={presentation.resource}>
										{presentation.resource}
									</code>
								</>
							)}
							{!isCompletion && !isCompact && (
								<span
									className={cn(
										"shrink-0 rounded-full border px-1.5 py-[0.5px] font-semibold text-[7px] uppercase tracking-wider scale-90",
										RISK_TONE[presentation.risk],
									)}>
									{presentation.risk === "high"
										? "High risk"
										: presentation.risk === "medium"
											? "Review"
											: "Low risk"}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Right Column: Side-by-Side Quick Action Buttons */}
				<div className={cn("flex items-center gap-1.5 shrink-0", isCompact ? "w-full grid grid-cols-2" : "flex-row")}>
					{/* Secondary Action (Cancel/Decline) */}
					{secondaryText && secondaryAction && (
						<Button
							aria-keyshortcuts={
								secondaryAction === "reject" || secondaryAction === "cancel" ? "Escape" : undefined
							}
							className={cn(
								buttonHeight,
								"rounded px-2 text-[9.5px] font-medium transition-all duration-200",
								isCompact ? "w-full" : "shrink-0",
								secondaryIsRecommended ? "shadow-sm border-transparent" : "",
							)}
							disabled={!canInteract}
							onClick={() => runAction(secondaryAction)}
							variant={secondaryIsRecommended ? "secondary" : "outline"}>
							<span className="truncate">
								{secondaryIsRecommended ? `${secondaryText} · Recommended` : secondaryText}
							</span>
						</Button>
					)}

					{/* Primary Action (Approve/Confirm) */}
					{primaryText && primaryAction && (
						<Button
							aria-keyshortcuts={presentation.kind === "approval" ? "Control+Enter Meta+Enter" : undefined}
							className={cn(
								buttonHeight,
								"rounded px-2.5 text-[9.5px] font-medium transition-all duration-200 shadow-sm shrink-0",
							)}
							disabled={!canInteract}
							onClick={() => runAction(primaryAction)}
							variant={presentation.isDestructive ? "danger" : secondaryIsRecommended ? "outline" : "default"}>
							{isProcessing ? <LoaderCircle aria-hidden className="size-3 animate-spin mr-1" /> : null}
							<span className="truncate">{primaryLabel}</span>
							{!isCompact && presentation.kind === "approval" && (
								<kbd className="ml-1 rounded bg-background/25 px-0.5 py-[1px] text-[7px] font-normal opacity-85">
									{isMac ? "⌘↵" : "Ctrl+Enter"}
								</kbd>
							)}
						</Button>
					)}
				</div>
			</div>

			{/* ── Collapsible details panel at bottom ── */}
			{!isCompletion && presentation.resource && (
				<details className="lumi-inline-disclosure border-t border-current/5">
					<summary className="flex cursor-pointer items-center gap-1 px-2.5 py-0.5 text-[8px] text-description/70 hover:text-foreground">
						<ChevronDown
							aria-hidden
							className="size-2.5 shrink-0 transition-transform [[open]>&]:rotate-0 -rotate-90"
							strokeWidth={2}
						/>
						<span>Show details</span>
					</summary>
					<div
						className="grid gap-1 px-2.5 pb-1.5 pt-0.5 text-[8px] leading-[1.3] text-foreground/80 border-t border-current/5"
						id={detailId}>
						{isCompact && presentation.resource && (
							<div className="flex min-w-0 items-center gap-1.5 text-foreground/90 mb-1">
								<File aria-hidden className="size-3 shrink-0 text-description/80" strokeWidth={1.75} />
								{resourceDisplay}
							</div>
						)}
						<div className="flex items-start gap-1.5">
							<ShieldAlert aria-hidden className="mt-px size-3 shrink-0 text-description/80" strokeWidth={1.75} />
							<span>
								<strong className="font-semibold text-foreground">{presentation.riskLabel}.</strong>{" "}
								{presentation.riskDetail}
								<span className="text-description/70"> {presentation.reversibility}</span>
							</span>
						</div>
					</div>
				</details>
			)}
		</section>
	)
}
