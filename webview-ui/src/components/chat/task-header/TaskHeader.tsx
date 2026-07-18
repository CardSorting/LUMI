import type { AuditMessageSnapshot, AuditTrend } from "@shared/audit/auditMessages"
import type { PreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import type { ResolvedCompletionFunnelSnapshot } from "@shared/completion/completionFunnelMessages"
import { DietCodeMessage } from "@shared/ExtensionMessage"
import { StringArrayRequest } from "@shared/proto/dietcode/common"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useIsCompact, useIsUltraCompact } from "@/context/DensityContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import ExpandHandle from "../ExpandHandle"
import { ExecutionStatusHeader } from "../execution-status/ExecutionStatusHeader"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import { CheckpointError } from "./CheckpointError"
import ContextWindow from "./ContextWindow"
import { FocusChain } from "./FocusChain"
import { highlightText } from "./Highlights"
import { TaskNotesSection } from "./TaskNotesSection"

const IS_DEV = process.env.IS_DEV === '"true"'
interface TaskHeaderProps {
	task: DietCodeMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	lastProgressMessageText?: string
	latestAuditMetadata?: DietCodeMessage["auditMetadata"]
	completionFunnelSnapshot?: ResolvedCompletionFunnelSnapshot
	auditTrend?: AuditTrend
	auditSnapshots?: AuditMessageSnapshot[]
	auditHealth?: AuditHealthSummary
	subagentAuditSummary?: SubagentAuditSummary
	checklistSummary?: PreCompletionChecklistSummary
	showFocusChainPlaceholder?: boolean
	onScrollToAuditMessage?: (ts: number) => void
	onScrollToLatestGateBlock?: () => void
	onScrollToLatestAdvisory?: () => void
	onClose: () => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-transparent hover:opacity-100 text-foreground"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	latestAuditMetadata,
	completionFunnelSnapshot,
	auditTrend: _auditTrend,
	auditSnapshots,
	auditHealth,
	subagentAuditSummary,
	checklistSummary,
	showFocusChainPlaceholder,
	onScrollToAuditMessage,
	onScrollToLatestGateBlock,
	onScrollToLatestAdvisory,
	onClose: _onClose,
	onSendMessage,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		checkpointManagerErrorMessage,
		focusChainSettings,
		navigateToSettings,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader,
		environment,
		dietcodeMessages,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const [deleteConfirmationVisible, setDeleteConfirmationVisible] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings("features")
	}, [navigateToSettings])

	const environmentBorderColor = getEnvironmentColor(environment, "border")
	const isCompact = useIsCompact()
	const isUltraCompact = useIsUltraCompact()

	// Check if text overflows the container (i.e., needs clamping)
	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			// Check if content height exceeds the max-height
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [isTaskExpanded, isHighlightedTextExpanded])

	// Handle click outside to collapse
	React.useEffect(() => {
		if (!isHighlightedTextExpanded) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (highlightedTextRef.current && !highlightedTextRef.current.contains(event.target as Node)) {
				setIsHighlightedTextExpanded(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [isHighlightedTextExpanded])

	// Simplified computed values
	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable = Boolean(totalCost) && modeFields.apiProvider !== "openai-codex" // Subscription-based, no per-token costs

	const handleCopyTask = useCallback(() => {
		if (task.text) {
			void navigator.clipboard.writeText(task.text)
		}
	}, [task.text])

	const handleDeleteTask = useCallback(() => {
		if (currentTaskItem?.id) {
			void TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [currentTaskItem.id] }))
			setDeleteConfirmationVisible(false)
		}
	}, [currentTaskItem?.id])

	return (
		<div className="flex flex-col min-h-0">
			<div
				className={cn(
					isTaskExpanded
						? isCompact
							? "pt-2.5 pb-2 px-2.5"
							: "pt-3 pb-2 px-3"
						: isCompact
							? "pt-1.5 pb-1 px-2.5"
							: "pt-2 pb-1.5 px-3",
				)}>
				<ExecutionStatusHeader
					auditHealth={auditHealth}
					auditMetadata={latestAuditMetadata}
					checkpointError={checkpointManagerErrorMessage}
					completionFunnel={completionFunnelSnapshot}
					isDetailsOpen={isTaskExpanded}
					messages={dietcodeMessages}
					onReviewBlock={onScrollToLatestGateBlock}
					onToggleDetails={() => setExpandTaskHeader(!isTaskExpanded)}
				/>
			</div>

			{isTaskExpanded && (
				<div
					className={cn(
						"mx-3 mb-2 rounded-lg border border-border/40 bg-(--vscode-toolbar-hoverBackground)/35 overflow-hidden flex flex-col",
						isUltraCompact ? "max-h-[25vh]" : isCompact ? "max-h-[30vh]" : "max-h-[38vh]",
					)}
					style={{ borderColor: environmentBorderColor }}>
					<div className={cn("overflow-y-auto flex flex-col gap-2.5 min-h-0", isCompact ? "p-2.5" : "p-3")}>
						<CheckpointError
							checkpointManagerErrorMessage={checkpointManagerErrorMessage}
							handleCheckpointSettingsClick={handleCheckpointSettingsClick}
						/>
						<div>
							<p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground m-0 mb-1.5">
								Task brief
							</p>
							<div
								className={cn(
									"ph-no-capture whitespace-pre-wrap break-words text-sm relative",
									isCompact ? "max-h-[3rem]" : "max-h-[4.5rem]",
									"overflow-hidden",
									{
										"max-h-[12rem] overflow-y-auto": isHighlightedTextExpanded,
									},
								)}
								ref={highlightedTextRef}>
								{highlightedText}
							</div>
							{isTextOverflowing && !isHighlightedTextExpanded && (
								<ExpandHandle isExpanded={false} onToggle={() => setIsHighlightedTextExpanded(true)} />
							)}
							{isHighlightedTextExpanded && isTextOverflowing && (
								<ExpandHandle isExpanded={true} onToggle={() => setIsHighlightedTextExpanded(false)} />
							)}
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						{focusChainSettings.enabled && (
							<FocusChain
								currentTaskItemId={currentTaskItem?.id}
								lastProgressMessageText={lastProgressMessageText}
								showPlaceholderWhenEmpty={showFocusChainPlaceholder}
							/>
						)}

						<ContextWindow
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							contextWindow={selectedModelInfo?.contextWindow}
							lastApiReqTotalTokens={lastApiReqTotalTokens}
							onSendMessage={onSendMessage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							useAutoCondense={false}
						/>

						<TaskNotesSection
							auditHealth={auditHealth}
							auditSnapshots={auditSnapshots}
							auditTrend={_auditTrend}
							checklistSummary={checklistSummary}
							completionFunnelSnapshot={completionFunnelSnapshot}
							latestAuditMetadata={latestAuditMetadata}
							onScrollToAuditMessage={onScrollToAuditMessage}
							onScrollToLatestAdvisory={onScrollToLatestAdvisory}
							onScrollToLatestGateBlock={onScrollToLatestGateBlock}
							subagentAuditSummary={subagentAuditSummary}
						/>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2.5 mt-0.5 border-t border-border/25">
							<button
								className="text-[10px] text-muted-foreground hover:text-foreground bg-transparent border-0 p-0 cursor-pointer"
								onClick={handleCopyTask}
								type="button">
								Copy prompt
							</button>
							{deleteConfirmationVisible ? (
								<fieldset
									aria-label="Confirm chat deletion"
									className="m-0 flex items-center gap-2 rounded-md border border-error/25 bg-error/[0.04] px-2 py-1">
									<span className="text-[10px] text-error">Delete permanently?</span>
									<button
										className="rounded border-0 bg-transparent px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
										onClick={() => setDeleteConfirmationVisible(false)}
										type="button">
										Cancel
									</button>
									<button
										className="rounded border border-error/35 bg-error/10 px-1.5 py-1 text-[10px] font-medium text-error hover:bg-error/15"
										onClick={handleDeleteTask}
										type="button">
										Delete
									</button>
								</fieldset>
							) : (
								<button
									className="text-[10px] text-muted-foreground hover:text-destructive bg-transparent border-0 p-0 cursor-pointer disabled:opacity-40"
									disabled={!currentTaskItem?.id}
									onClick={() => setDeleteConfirmationVisible(true)}
									type="button">
									Delete chat…
								</button>
							)}
							{IS_DEV && (
								<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
							)}
							{isCostAvailable && (
								<span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
									${totalCost?.toFixed(4)}
								</span>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default TaskHeader
