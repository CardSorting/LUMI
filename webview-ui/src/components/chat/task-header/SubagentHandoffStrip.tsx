import { formatSubagentParentSignal, type SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import { NetworkIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"
import { auditStrip } from "../audit/auditUiStyles"

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
			aria-label="A few notes"
			className={cn(
				"mt-2 px-3 py-2.5 text-[10px] mira-audit-exhale transition-opacity duration-[2s]",
				auditStrip,
				className,
			)}>
			<div className="flex items-center gap-2 flex-wrap mb-1.5">
				<NetworkIcon className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
				<span className="font-medium text-description/85">A few notes</span>
				{isActive && (
					<span className="text-[8px] font-medium text-blue-600 dark:text-blue-400">
						{summary.runningCount + summary.pendingCount} helping
					</span>
				)}
				{summary.hasParentGateBlocked && (
					<span className="text-[8px] font-medium text-amber-700 dark:text-amber-400">Waiting on earlier check</span>
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
