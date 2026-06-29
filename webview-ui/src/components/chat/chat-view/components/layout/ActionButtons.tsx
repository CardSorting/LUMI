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
	const { enableCheckpointsSetting, checkpointManagerErrorMessage } = useExtensionState()
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
	const canInteract = enableButtons && !isProcessing
	const executionControlConfigured = secondaryAction === "cancel" && !primaryAction
	const isExecutionControl = Boolean(executionControlConfigured && lastMessage && isApiRequestInProgress(lastMessage))
	const checkpointAvailable = enableCheckpointsSetting !== false && !checkpointManagerErrorMessage
	const presentation = useMemo(
		() => getActionPresentation(lastMessage, buttonConfig, { checkpointAvailable }),
		[lastMessage, buttonConfig, checkpointAvailable],
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

	// Button config is intentionally presentation-only and can lag the final API
	// payload. Never offer Stop once the request records cancellation/completion.
	const isCompact = useIsCompact()

	if (!task || !hasButtons || (executionControlConfigured && !isExecutionControl)) return null

	const opacity = canInteract || task.partial === true ? 1 : 0.62
	const detailId = `lumi-action-detail-${lastMessage?.ts ?? "current"}`

	if (isExecutionControl && secondaryText && secondaryAction) {
		return (
			<fieldset
				aria-label="Execution controls"
				className="m-0 flex items-center justify-between gap-3 border-0 px-3 pb-2"
				style={{ opacity }}>
				<div className="flex min-w-0 items-center gap-1.5 text-[10px] text-description">
					<LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" strokeWidth={1.75} />
					<span className="truncate">Execution active</span>
					{!isCompact && (
						<kbd className="rounded border border-border/60 px-1 py-0.5 font-sans text-[8px] text-description">
							Esc
						</kbd>
					)}
				</div>
				<Button
					aria-keyshortcuts="Escape"
					className={cn(
						"shrink-0 rounded-md border-error/30 px-3 text-[11px] text-error hover:bg-error/[0.06]",
						isCompact ? "h-[36px]" : "h-8",
					)}
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}
					variant="outline">
					Stop execution
				</Button>
			</fieldset>
		)
	}

	const sectionLabel =
		presentation.kind === "recovery" ? "Recovery path" : presentation.kind === "completion" ? "Next step" : "Approval queue"
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

	const buttonHeight = isCompact ? "h-[36px]" : "h-9"

	return (
		<section
			aria-describedby={!isCompletion ? detailId : undefined}
			aria-label={sectionLabel}
			className={cn("mx-3 mb-2 overflow-hidden rounded-lg border", panelTone)}
			ref={panelRef}
			style={{ opacity }}>
			{/* ── Summary row: always visible ── */}
			<div className={cn("flex items-start gap-2 border-b border-current/10", isCompact ? "px-2.5 py-2" : "px-3 py-2.5")}>
				{isRecovery ? (
					<CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-error" strokeWidth={1.75} />
				) : isCompletion ? (
					<CheckCircle2 aria-hidden className="mt-px size-4 shrink-0 text-success" strokeWidth={1.75} />
				) : presentation.isDestructive ? (
					<ShieldAlert aria-hidden className="mt-px size-4 shrink-0 text-error" strokeWidth={1.75} />
				) : (
					<ShieldCheck
						aria-hidden
						className="mt-px size-4 shrink-0 text-amber-700 dark:text-amber-300"
						strokeWidth={1.75}
					/>
				)}
				<div className="min-w-0 flex-1">
					{!isCompact && (
						<p className="m-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-description/70">
							{sectionLabel}
						</p>
					)}
					<p
						className={cn(
							"m-0 font-semibold leading-snug text-foreground",
							isCompact ? "text-[10px] truncate" : "mt-0.5 text-[11px]",
						)}>
						{presentation.summary}
					</p>
					{/* Compact: inline risk + reversibility signal — always visible */}
					{isCompact && !isCompletion && (
						<p className="m-0 mt-0.5 flex items-center gap-1.5 text-[8px] text-description">
							<span className={cn("font-medium", presentation.isDestructive ? "text-error" : "text-foreground/75")}>
								{presentation.riskLabel}
							</span>
							<span className="text-description/50">·</span>
							<span className={cn(presentation.isDestructive ? "text-error/80" : "text-description")}>
								{reversibilitySignal}
							</span>
							{presentation.resource && (
								<>
									<span className="text-description/50">·</span>
									<span className="truncate max-w-[100px]">{presentation.resource.split("/").pop()}</span>
								</>
							)}
						</p>
					)}
				</div>
				{!isCompletion ? (
					<span
						className={cn(
							"shrink-0 rounded-full border px-1.5 py-0.5 font-medium",
							isCompact ? "text-[8px]" : "text-[9px]",
							RISK_TONE[presentation.risk],
						)}>
						{presentation.risk === "high" ? "High risk" : presentation.risk === "medium" ? "Review" : "Low risk"}
					</span>
				) : null}
			</div>

			{/* ── Evidence block: collapsible at compact, always visible at comfortable ── */}
			{!isCompletion ? (
				isCompact ? (
					<details className="lumi-inline-disclosure border-b border-current/10">
						<summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[9px] text-description hover:text-foreground">
							<ChevronDown
								aria-hidden
								className="size-3 shrink-0 transition-transform [[open]>&]:rotate-0 -rotate-90"
								strokeWidth={1.75}
							/>
							<span>Evidence details</span>
						</summary>
						<div className="grid gap-1.5 px-2.5 pb-2 text-[9px] leading-[1.4]" id={detailId}>
							{presentation.resource ? (
								<div className="flex min-w-0 items-center gap-2 text-foreground/90">
									<File aria-hidden className="size-3 shrink-0 text-description" strokeWidth={1.75} />
									<code
										className="min-w-0 truncate bg-transparent font-mono text-[8px]"
										title={presentation.resource}>
										{presentation.resource}
									</code>
								</div>
							) : null}
							<div className="flex items-start gap-2 text-foreground/85">
								<ShieldAlert aria-hidden className="mt-px size-3 shrink-0 text-description" strokeWidth={1.75} />
								<span>
									<strong className="font-medium">{presentation.riskLabel}.</strong> {presentation.riskDetail}
									<span className="text-description"> {presentation.reversibility}</span>
								</span>
							</div>
						</div>
					</details>
				) : (
					<div className="grid gap-1.5 border-b border-current/10 px-3 py-2 text-[10px] leading-[1.4]" id={detailId}>
						{presentation.resource ? (
							<div className="flex min-w-0 items-center gap-2 text-foreground/90">
								<File aria-hidden className="size-3.5 shrink-0 text-description" strokeWidth={1.75} />
								<code
									className="min-w-0 truncate bg-transparent font-mono text-[9px]"
									title={presentation.resource}>
									{presentation.resource}
								</code>
							</div>
						) : null}
						<div className="flex items-start gap-2 text-foreground/85">
							<ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0 text-description" strokeWidth={1.75} />
							<span>
								<strong className="font-medium">{presentation.riskLabel}.</strong> {presentation.riskDetail}
								<span className="text-description"> {presentation.reversibility}</span>
							</span>
						</div>
					</div>
				)
			) : null}

			{/* ── Action buttons ── */}
			{presentation.isDestructive && primaryText && primaryAction && secondaryText && secondaryAction ? (
				<div className={cn("grid gap-2", isCompact ? "grid-cols-1 p-2" : "grid-cols-[minmax(0,1fr)_auto] p-2.5")}>
					<Button
						className={cn(buttonHeight, "w-full rounded-md px-3 text-[11px]")}
						disabled={!canInteract}
						onClick={() => runAction(secondaryAction)}>
						{isProcessing ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : null}
						{secondaryText} · Recommended
					</Button>
					<div className={cn(isCompact ? "border-t border-error/20 pt-2" : "border-l border-error/20 pl-2")}>
						<Button
							aria-label={`${primaryLabel}. Destructive action`}
							className={cn(buttonHeight, "w-full rounded-md px-3 text-[11px]")}
							disabled={!canInteract}
							onClick={() => runAction(primaryAction)}
							variant="danger">
							{primaryLabel}
						</Button>
					</div>
				</div>
			) : (
				<div className={cn("grid gap-2", isCompact ? "grid-cols-1 p-2" : "grid-cols-2 p-2.5")}>
					{secondaryIsRecommended && secondaryText && secondaryAction ? (
						<Button
							className={cn(buttonHeight, "w-full rounded-md px-3 text-[11px]")}
							disabled={!canInteract}
							onClick={() => runAction(secondaryAction)}>
							{secondaryText}
						</Button>
					) : null}
					{primaryText && primaryAction ? (
						<Button
							aria-keyshortcuts={presentation.kind === "approval" ? "Control+Enter Meta+Enter" : undefined}
							className={cn(buttonHeight, "w-full rounded-md px-3 text-[11px]")}
							disabled={!canInteract}
							onClick={() => runAction(primaryAction)}
							variant={secondaryIsRecommended ? "outline" : "default"}>
							{isProcessing ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : null}
							{primaryLabel}
						</Button>
					) : null}
					{!secondaryIsRecommended && secondaryText && secondaryAction ? (
						<Button
							aria-keyshortcuts={secondaryAction === "reject" ? "Escape" : undefined}
							className={cn(buttonHeight, "w-full rounded-md px-3 text-[11px]")}
							disabled={!canInteract}
							onClick={() => runAction(secondaryAction)}
							variant="outline">
							{secondaryText}
						</Button>
					) : null}
				</div>
			)}
		</section>
	)
}
