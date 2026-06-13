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
	className?: string
}

const STATUS_STYLES = {
	running: "border-blue-500/40 text-blue-600 dark:text-blue-400",
	blocked: "border-red-500/40 text-red-600 dark:text-red-400",
	warning: "border-amber-500/40 text-amber-600 dark:text-amber-400",
	idle: "border-description/30 text-description/70",
} as const

export const SubagentAuditBadge = memo(({ summary, className }: SubagentAuditBadgeProps) => {
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

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border",
				STATUS_STYLES[visualLevel],
				className,
			)}
			title={
				[
					summary?.totalAgents ? `${summary.totalAgents} subagent(s)` : undefined,
					isRunning ? `${activeAgents} active` : undefined,
					summary?.failedCount ? `${summary.failedCount} failed` : undefined,
					labels.length > 0 ? labels.join(" · ") : undefined,
				]
					.filter(Boolean)
					.join(" · ") || undefined
			}>
			<Icon className="size-2.5" />
			{isRunning ? `${activeAgents} swarm` : "Swarm"}
			{summary?.hasParentGateBlocked && <span className="opacity-90">· gate</span>}
			{summary?.parentGateSignals.length ? (
				<span className="font-mono opacity-80">{summary.parentGateSignals.length}</span>
			) : null}
		</span>
	)
})

SubagentAuditBadge.displayName = "SubagentAuditBadge"
