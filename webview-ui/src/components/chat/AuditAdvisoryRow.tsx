import { getNewAdvisoryViolations } from "@shared/audit/auditAdvisoryDedup"
import { getPreviousAdvisoryAuditBeforeTs } from "@shared/audit/auditMessages"
import { hasCriticalViolations } from "@shared/audit/auditSeverity"
import { getViolationRemediation } from "@shared/audit/completionAudit"
import { formatViolationLabel, HARDENING_GRADE_STYLES, type HardeningGrade } from "@shared/audit/taskAuditUtils"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { AlertTriangleIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "./AuditReportPanel"
import { AuditHeaderJumpLink } from "./task-header/AuditHeaderJumpLink"

interface AuditAdvisoryRowProps {
	text?: string
	auditMetadata: TaskAuditMetadata
	messageTs?: number
}

/** SonarQube-style act-mode advisory annotation — surfaces progress audit findings in chat. */
export const AuditAdvisoryRow = memo(({ text, auditMetadata, messageTs }: AuditAdvisoryRowProps) => {
	const [expanded, setExpanded] = useState(false)
	const { dietcodeMessages } = useExtensionState()
	const newViolations = useMemo(() => {
		if (!messageTs) {
			return []
		}
		const previous = getPreviousAdvisoryAuditBeforeTs(dietcodeMessages, messageTs)
		return getNewAdvisoryViolations(auditMetadata, previous)
	}, [auditMetadata, dietcodeMessages, messageTs])
	const grade = auditMetadata.hardening_grade as HardeningGrade | undefined
	const topViolations = auditMetadata.violations?.slice(0, 4) ?? []
	const hasCritical = hasCriticalViolations(auditMetadata.violations)

	return (
		<div className="my-2 rounded-sm border border-amber-500/30 bg-amber-500/5 overflow-hidden">
			<div className="border-l-4 border-amber-500 px-3 py-2.5">
				<div className="flex items-start gap-2">
					<AlertTriangleIcon className="size-4 text-amber-500 shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0 space-y-1.5">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
								Act-Mode Audit Advisory
							</span>
							{grade && (
								<span
									className={cn(
										"px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase border",
										HARDENING_GRADE_STYLES[grade],
									)}>
									{grade}
								</span>
							)}
							{Number.isFinite(auditMetadata.hardening_score) && (
								<span className="font-mono text-[9px] font-bold text-amber-600/90 dark:text-amber-400/90">
									{auditMetadata.hardening_score}/100
								</span>
							)}
							{auditMetadata.divergence_detected && (
								<span className="text-[8px] font-bold uppercase text-amber-600 dark:text-amber-400">
									Divergent
								</span>
							)}
							{hasCritical && (
								<span
									className="text-[8px] font-bold uppercase text-red-600 dark:text-red-400"
									title="Critical findings may block completion via advisory escalation">
									Completion risk
								</span>
							)}
						</div>

						{newViolations.length > 0 && (
							<p className="text-[9px] font-bold text-amber-700 dark:text-amber-300">
								New since last advisory: {newViolations.slice(0, 4).map(formatViolationLabel).join(", ")}
							</p>
						)}

						{topViolations.length > 0 && (
							<ul className="list-disc list-inside text-[9px] text-amber-700/90 dark:text-amber-400/90 space-y-0.5">
								{topViolations.map((violation) => {
									const hint = getViolationRemediation(violation)
									return (
										<li className="break-words" key={violation}>
											<span className="font-bold">{formatViolationLabel(violation)}</span>
											{hint && <span className="block pl-3 font-normal opacity-90">{hint}</span>}
										</li>
									)
								})}
							</ul>
						)}

						{text && !topViolations.length && (
							<p className="text-[10px] text-description/80 whitespace-pre-wrap">{text}</p>
						)}

						<button
							aria-expanded={expanded}
							className="text-[8px] uppercase tracking-wider font-bold text-amber-600/80 dark:text-amber-400/80 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer bg-transparent border-0 p-0"
							onClick={() => setExpanded(!expanded)}
							type="button">
							{expanded ? "Hide audit report" : "Show audit report"}
						</button>

						<AuditHeaderJumpLink label="Open audit panel in header" />
					</div>
				</div>
			</div>

			{expanded && (
				<div className="border-t border-amber-500/15 px-2 pb-2">
					<AuditReportPanel auditMetadata={auditMetadata} variant="neutral" />
				</div>
			)}
		</div>
	)
})

AuditAdvisoryRow.displayName = "AuditAdvisoryRow"
