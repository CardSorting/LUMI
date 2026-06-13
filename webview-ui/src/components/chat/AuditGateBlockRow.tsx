import { formatGateReasonsForDisplay } from "@shared/audit/auditGateCatalog"
import { buildQualityGateStatus } from "@shared/audit/auditGateStatus"
import { HARDENING_GRADE_STYLES, type HardeningGrade } from "@shared/audit/taskAuditUtils"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ShieldOffIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "./AuditReportPanel"
import { MarkdownRow } from "./MarkdownRow"

interface AuditGateBlockRowProps {
	text?: string
	auditMetadata: TaskAuditMetadata
}

/** GitHub Checks-style gate failure annotation — makes gate blocks visible in chat. */
export const AuditGateBlockRow = memo(({ text, auditMetadata }: AuditGateBlockRowProps) => {
	const [expanded, setExpanded] = useState(true)
	const gateOptions = useAuditGateEvaluation(auditMetadata)

	const qualityGate = useMemo(() => buildQualityGateStatus(auditMetadata, gateOptions), [auditMetadata, gateOptions])

	const grade = auditMetadata.hardening_grade as HardeningGrade | undefined
	const reasonLines = useMemo(() => {
		const codes = auditMetadata.gate_reason_codes ?? qualityGate?.reasonCodes ?? []
		return formatGateReasonsForDisplay(
			codes
				.filter((code) => code !== "gate_disabled")
				.map((code) => ({
					code,
					message: code,
				})),
		)
	}, [auditMetadata.gate_reason_codes, qualityGate?.reasonCodes])

	return (
		<div className="my-2 rounded-sm border border-red-500/30 bg-red-500/5 overflow-hidden">
			<div className="border-l-4 border-red-500 px-3 py-2.5">
				<div className="flex items-start gap-2">
					<ShieldOffIcon className="size-4 text-red-500 shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0 space-y-1.5">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400">
								Completion Gate Blocked
							</span>
							{auditMetadata.gate_block_count ? (
								<span className="text-[9px] font-bold text-red-500/80">
									Attempt {auditMetadata.gate_block_count}
								</span>
							) : null}
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
								<span className="font-mono text-[9px] font-bold text-red-600/90 dark:text-red-400/90">
									{auditMetadata.hardening_score}/100
									{Number.isFinite(auditMetadata.gate_effective_threshold)
										? ` · threshold ${auditMetadata.gate_effective_threshold}`
										: qualityGate
											? ` · threshold ${qualityGate.effectiveThreshold}`
											: ""}
								</span>
							)}
						</div>

						{reasonLines.length > 0 && (
							<ul className="list-disc list-inside text-[9px] text-red-600/90 dark:text-red-400/90 space-y-0.5">
								{reasonLines.map((line) => (
									<li className="break-words" key={line}>
										{line}
									</li>
								))}
							</ul>
						)}

						{text && (
							<div className="text-[10px] text-description/80 prose prose-sm max-w-none">
								<MarkdownRow markdown={text} showCursor={false} />
							</div>
						)}

						<button
							aria-expanded={expanded}
							className="text-[8px] uppercase tracking-wider font-bold text-red-600/80 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-400 cursor-pointer bg-transparent border-0 p-0"
							onClick={() => setExpanded(!expanded)}
							type="button">
							{expanded ? "Hide audit report" : "Show audit report"}
						</button>
					</div>
				</div>
			</div>

			{expanded && (
				<div className="border-t border-red-500/15 px-2 pb-2">
					<AuditReportPanel auditMetadata={auditMetadata} variant="neutral" />
				</div>
			)}
		</div>
	)
})

AuditGateBlockRow.displayName = "AuditGateBlockRow"
