import type { AuditMessageSnapshot, AuditTrend } from "@shared/audit/auditMessages"
import type { PreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import { DietCodeMessage } from "@shared/ExtensionMessage"
import { StringArrayRequest } from "@shared/proto/dietcode/common"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import ExpandHandle from "../ExpandHandle"
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
		environment,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings("features")
	}, [navigateToSettings])

	const environmentBorderColor = getEnvironmentColor(environment, "border")

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

	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" &&
			modeFields.apiProvider !== "ollama" &&
			modeFields.apiProvider !== "lmstudio" &&
			modeFields.apiProvider !== "openai-codex") // Subscription-based, no per-token costs

	const handleCopyTask = useCallback(() => {
		if (task.text) {
			void navigator.clipboard.writeText(task.text)
		}
	}, [task.text])

	const handleDeleteTask = useCallback(() => {
		if (currentTaskItem?.id) {
			void TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [currentTaskItem.id] }))
		}
	}, [currentTaskItem?.id])

	return (
		<div className="flex flex-col min-h-0">
			<CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
			/>

			{isTaskExpanded && (
				<div
					className="mx-1.5 mb-1 rounded-sm border border-border/30 bg-(--vscode-toolbar-hoverBackground)/50 overflow-hidden flex flex-col max-h-[32vh]"
					style={{ borderColor: environmentBorderColor }}>
					<div className="overflow-y-auto flex flex-col gap-1 p-2 min-h-0">
						<div>
							<p className="text-[10px] font-medium text-muted-foreground m-0 mb-1">You asked</p>
							<div
								className={cn(
									"ph-no-capture whitespace-pre-wrap break-words text-sm relative",
									"max-h-[4.5rem] overflow-hidden",
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
							latestAuditMetadata={latestAuditMetadata}
							onScrollToAuditMessage={onScrollToAuditMessage}
							onScrollToLatestAdvisory={onScrollToLatestAdvisory}
							onScrollToLatestGateBlock={onScrollToLatestGateBlock}
							subagentAuditSummary={subagentAuditSummary}
						/>

						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 mt-1 border-t border-border/20">
							<button
								className="text-[10px] text-muted-foreground hover:text-foreground bg-transparent border-0 p-0 cursor-pointer"
								onClick={handleCopyTask}
								type="button">
								Copy prompt
							</button>
							<button
								className="text-[10px] text-muted-foreground hover:text-destructive bg-transparent border-0 p-0 cursor-pointer disabled:opacity-40"
								disabled={!currentTaskItem?.id}
								onClick={handleDeleteTask}
								type="button">
								Delete chat
							</button>
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
