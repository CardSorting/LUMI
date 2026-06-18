import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { memo } from "react"
import { cn } from "@/lib/utils"

export interface TaskStatusChipProps {
	auditHealth?: AuditHealthSummary
	auditMetadata?: TaskAuditMetadata
	subagentAuditSummary?: SubagentAuditSummary
	onExpand: () => void
}

/**
 * Single status affordance when the task header is collapsed —
 * replaces a row of audit badges in narrow sidebars.
 */
export const TaskStatusChip = memo(({ auditHealth, auditMetadata, subagentAuditSummary, onExpand }: TaskStatusChipProps) => {
	const hasGateBlock = auditMetadata?.gate_blocked === true
	const hasWarnings = (auditHealth?.warningViolationCount ?? 0) + (auditHealth?.criticalViolationCount ?? 0) > 0
	const hasSubagent = (subagentAuditSummary?.parentGateSignals.length ?? 0) > 0
	const hasNotes = hasGateBlock || hasWarnings || hasSubagent || Boolean(auditHealth?.latestGrade)

	if (!hasNotes) {
		return null
	}

	const tone = hasGateBlock
		? "border-amber-500/50 text-amber-700 dark:text-amber-400 bg-amber-500/10"
		: hasWarnings
			? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
			: "border-border/50 text-muted-foreground bg-accent/10"

	const label = hasGateBlock ? "Needs review" : hasWarnings ? "Notes" : "Details"

	return (
		<button
			aria-label="Show task details and notes"
			className={cn(
				"shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
				"hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				tone,
			)}
			onClick={(e) => {
				e.stopPropagation()
				onExpand()
			}}
			type="button">
			{label}
		</button>
	)
})

TaskStatusChip.displayName = "TaskStatusChip"
