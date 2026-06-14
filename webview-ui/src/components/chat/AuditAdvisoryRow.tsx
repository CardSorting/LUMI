import { getNewAdvisoryViolations } from "@shared/audit/auditAdvisoryDedup"
import { getPreviousAdvisoryAuditBeforeTs } from "@shared/audit/auditMessages"
import { hasCriticalViolations } from "@shared/audit/auditSeverity"
import { getViolationRemediation } from "@shared/audit/auditViolationRemediation"
import { formatViolationLabel, HARDENING_GRADE_STYLES, type HardeningGrade } from "@shared/audit/taskAuditUtils"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { AlertTriangleIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "./AuditReportPanel"
import { auditSideAccent, auditStrip } from "./audit/auditUiStyles"
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
		<div className={cn("my-2 lumi-audit-exhale transition-opacity duration-[2s]", auditStrip)}>
			<div className={auditSideAccent}>
				<div className="flex items-start gap-2">
					<AlertTriangleIcon className="size-4 text-amber-500/70 shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0 space-y-1.5">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-[10px] font-medium text-amber-800/90 dark:text-amber-300/90">
								An observation
							</span>
							{grade && (
								<span
									className={cn(
										"px-1.5 py-0.5 rounded-full text-[8px] font-medium border",
										HARDENING_GRADE_STYLES[grade],
									)}>
									{grade}
								</span>
							)}
							{Number.isFinite(auditMetadata.hardening_score) && (
								<span className="font-mono text-[9px] font-medium text-amber-700/90 dark:text-amber-400/90">
									{auditMetadata.hardening_score}/100
								</span>
							)}
							{auditMetadata.divergence_detected && (
								<span className="text-[8px] font-medium text-amber-700 dark:text-amber-400">Drift noticed</span>
							)}
							{hasCritical && (
								<span
									className="text-[8px] font-medium text-amber-800 dark:text-amber-300"
									title="Some findings may affect wrap-up">
									Might affect wrap-up
								</span>
							)}
						</div>

						{newViolations.length > 0 && (
							<p className="text-[9px] font-normal text-amber-800/85 dark:text-amber-300/85">
								New since last look: {newViolations.slice(0, 4).map(formatViolationLabel).join(", ")}
							</p>
						)}

						{topViolations.length > 0 && (
							<ul className="list-disc list-inside text-[9px] text-amber-700/90 dark:text-amber-400/90 space-y-0.5">
								{topViolations.map((violation) => {
									const hint = getViolationRemediation(violation)
									return (
										<li className="break-words" key={violation}>
											<span className="font-normal">{formatViolationLabel(violation)}</span>
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
							className="text-[9px] font-medium text-amber-700/80 dark:text-amber-400/80 hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer bg-transparent border-0 p-0"
							onClick={() => setExpanded(!expanded)}
							type="button">
							{expanded ? "Hide details" : "Show details"}
						</button>

						<AuditHeaderJumpLink label="See details in header" />
					</div>
				</div>
			</div>

			{expanded && (
				<div className="border-t border-description/6 px-2 pb-2">
					<AuditReportPanel auditMetadata={auditMetadata} variant="neutral" />
				</div>
			)}
		</div>
	)
})

AuditAdvisoryRow.displayName = "AuditAdvisoryRow"
