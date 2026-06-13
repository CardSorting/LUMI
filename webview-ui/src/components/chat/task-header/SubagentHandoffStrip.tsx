import { formatSubagentParentSignal, type SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import { NetworkIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

interface SubagentHandoffStripProps {
	summary?: SubagentAuditSummary
	className?: string
}

/** GitHub Actions downstream-context strip — surfaces parent gate signals handed to subagent swarm. */
export const SubagentHandoffStrip = memo(({ summary, className }: SubagentHandoffStripProps) => {
	const labels = useMemo(() => summary?.parentGateSignals.map(formatSubagentParentSignal) ?? [], [summary?.parentGateSignals])

	if (!summary || labels.length === 0) {
		return null
	}

	const isActive = summary.swarmStatus === "running" || summary.runningCount > 0 || summary.pendingCount > 0

	return (
		<section
			aria-label="Subagent audit handoff"
			className={cn(
				"mt-2 rounded-xs border px-2.5 py-2 text-[9px]",
				isActive ? "border-blue-500/25 bg-blue-500/5" : "border-description/15 bg-black/5 dark:bg-white/5",
				className,
			)}>
			<div className="flex items-center gap-2 flex-wrap mb-1.5">
				<NetworkIcon className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
				<span className="font-bold uppercase tracking-wider text-description/80">Subagent Handoff</span>
				{isActive && (
					<span className="text-[8px] font-bold uppercase text-blue-600 dark:text-blue-400">
						{summary.runningCount + summary.pendingCount} active
					</span>
				)}
				{summary.hasParentGateBlocked && (
					<span className="text-[8px] font-bold uppercase text-red-500">parent gate blocked</span>
				)}
			</div>
			<ul className="list-disc list-inside space-y-0.5 text-description/85">
				{labels.map((label) => (
					<li className="break-words" key={label}>
						{label}
					</li>
				))}
			</ul>
		</section>
	)
})

SubagentHandoffStrip.displayName = "SubagentHandoffStrip"
