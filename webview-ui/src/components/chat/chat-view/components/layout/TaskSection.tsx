import type { AuditMessageSnapshot, AuditTrend } from "@shared/audit/auditMessages"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
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
	selectedModelInfo: {
		supportsPromptCache: boolean
		supportsImages: boolean
	}
	messageHandlers: MessageHandlers
	lastProgressMessageText?: string
	showFocusChainPlaceholder?: boolean
	onScrollToAuditMessage?: (ts: number) => void
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
	selectedModelInfo,
	messageHandlers,
	lastProgressMessageText,
	showFocusChainPlaceholder,
	onScrollToAuditMessage,
}) => {
	return (
		<TaskHeader
			auditHealth={auditHealth}
			auditSnapshots={auditSnapshots}
			auditTrend={auditTrend}
			cacheReads={apiMetrics.totalCacheReads}
			cacheWrites={apiMetrics.totalCacheWrites}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			lastProgressMessageText={lastProgressMessageText}
			latestAuditMetadata={latestAuditMetadata}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onScrollToAuditMessage={onScrollToAuditMessage}
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
