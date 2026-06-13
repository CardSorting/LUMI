import {
	formatSubagentParentSignal,
	type SubagentAuditSummary,
	shouldShowSubagentAuditSummary,
} from "@shared/audit/auditSubagentRollup"
import { BotIcon, ShieldAlertIcon, ShieldOffIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

interface SubagentAuditBadgeProps {
	summary?: SubagentAuditSummary
	onExpandTaskHeader?: () => void
	className?: string
}

const STATUS_STYLES = {
	running: "border-blue-500/40 text-blue-600 dark:text-blue-400",
	blocked: "border-amber-500/35 text-amber-700 dark:text-amber-400",
	warning: "border-amber-500/40 text-amber-600 dark:text-amber-400",
	idle: "border-description/30 text-description/70",
} as const

export const SubagentAuditBadge = memo(({ summary, onExpandTaskHeader, className }: SubagentAuditBadgeProps) => {
	const labels = useMemo(() => summary?.parentGateSignals.map(formatSubagentParentSignal) ?? [], [summary?.parentGateSignals])

	if (!shouldShowSubagentAuditSummary(summary)) {
		return null
	}

	const activeAgents = (summary?.runningCount ?? 0) + (summary?.pendingCount ?? 0)
	const isRunning = summary?.swarmStatus === "running" || activeAgents > 0
	const visualLevel = summary?.hasParentGateBlocked
		? "blocked"
		: summary?.hasParentAdvisoryFindings || summary?.hasParentCriticalViolations
			? "warning"
			: isRunning
				? "running"
				: "idle"

	const Icon = summary?.hasParentGateBlocked ? ShieldOffIcon : summary?.hasParentAdvisoryFindings ? ShieldAlertIcon : BotIcon

	const titleText =
		[
			summary?.totalAgents ? `${summary.totalAgents} helper(s)` : undefined,
			isRunning ? `${activeAgents} active` : undefined,
			summary?.failedCount ? `${summary.failedCount} didn't work out` : undefined,
			labels.length > 0 ? labels.join(" · ") : undefined,
			onExpandTaskHeader ? "Click for a little more detail" : undefined,
		]
			.filter(Boolean)
			.join(" · ") || undefined

	const badgeClassName = cn(
		"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
		STATUS_STYLES[visualLevel],
		onExpandTaskHeader && "cursor-pointer hover:opacity-90",
		className,
	)

	const badgeContent = (
		<>
			<Icon className="size-2.5" />
			{isRunning ? `${activeAgents} helping` : "Extra help"}
			{summary?.hasParentGateBlocked && <span className="opacity-90">· gate</span>}
			{summary?.parentGateSignals.length ? (
				<span className="font-mono opacity-80">{summary.parentGateSignals.length}</span>
			) : null}
		</>
	)

	if (onExpandTaskHeader) {
		return (
			<button
				className={cn(badgeClassName, "bg-transparent font-sans")}
				onClick={(event) => {
					event.stopPropagation()
					onExpandTaskHeader()
				}}
				title={titleText}
				type="button">
				{badgeContent}
			</button>
		)
	}

	return (
		<span className={badgeClassName} title={titleText}>
			{badgeContent}
		</span>
	)
})

SubagentAuditBadge.displayName = "SubagentAuditBadge"
