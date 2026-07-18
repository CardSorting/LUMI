import type { AuditMessageSnapshot, AuditTrend } from "@shared/audit/auditMessages"
import type { PreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import type { ResolvedCompletionFunnelSnapshot } from "@shared/completion/completionFunnelMessages"
import { DietCodeMessage } from "@shared/ExtensionMessage"
import React from "react"
import TaskHeader from "@/components/chat/task-header/TaskHeader"
import { MessageHandlers } from "../../types/chatTypes"

interface TaskSectionProps {
	task: DietCodeMessage
	apiMetrics: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites?: number
		totalCacheReads?: number
		totalCost: number
	}
	lastApiReqTotalTokens?: number
	latestAuditMetadata?: DietCodeMessage["auditMetadata"]
	auditTrend?: AuditTrend
	auditSnapshots?: AuditMessageSnapshot[]
	auditHealth?: AuditHealthSummary
	subagentAuditSummary?: SubagentAuditSummary
	checklistSummary?: PreCompletionChecklistSummary
	selectedModelInfo: {
		supportsPromptCache: boolean
		supportsImages: boolean
	}
	messageHandlers: MessageHandlers
	lastProgressMessageText?: string
	showFocusChainPlaceholder?: boolean
	onScrollToAuditMessage?: (ts: number) => void
	onScrollToLatestGateBlock?: () => void
	onScrollToLatestAdvisory?: () => void
	completionFunnelSnapshot?: ResolvedCompletionFunnelSnapshot
}

/**
 * Task section shown when there's an active task
 * Includes the task header and manages task-specific UI
 */
export const TaskSection: React.FC<TaskSectionProps> = ({
	task,
	apiMetrics,
	lastApiReqTotalTokens,
	latestAuditMetadata,
	auditTrend,
	auditSnapshots,
	auditHealth,
	subagentAuditSummary,
	checklistSummary,
	selectedModelInfo,
	messageHandlers,
	lastProgressMessageText,
	showFocusChainPlaceholder,
	onScrollToAuditMessage,
	onScrollToLatestGateBlock,
	onScrollToLatestAdvisory,
	completionFunnelSnapshot,
}) => {
	return (
		<TaskHeader
			auditHealth={auditHealth}
			auditSnapshots={auditSnapshots}
			auditTrend={auditTrend}
			cacheReads={apiMetrics.totalCacheReads}
			cacheWrites={apiMetrics.totalCacheWrites}
			checklistSummary={checklistSummary}
			completionFunnelSnapshot={completionFunnelSnapshot}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			lastProgressMessageText={lastProgressMessageText}
			latestAuditMetadata={latestAuditMetadata}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onScrollToAuditMessage={onScrollToAuditMessage}
			onScrollToLatestAdvisory={onScrollToLatestAdvisory}
			onScrollToLatestGateBlock={onScrollToLatestGateBlock}
			onSendMessage={messageHandlers.handleSendMessage}
			showFocusChainPlaceholder={showFocusChainPlaceholder}
			subagentAuditSummary={subagentAuditSummary}
			task={task}
			tokensIn={apiMetrics.totalTokensIn}
			tokensOut={apiMetrics.totalTokensOut}
			totalCost={apiMetrics.totalCost}
		/>
	)
}
