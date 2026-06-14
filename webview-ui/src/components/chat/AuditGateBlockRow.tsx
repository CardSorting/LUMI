import { buildGateReasonLinesFromMetadata } from "@shared/audit/auditGateCatalog"
import { buildQualityGateStatus } from "@shared/audit/auditGateStatus"
import { buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { HARDENING_GRADE_STYLES, type HardeningGrade } from "@shared/audit/taskAuditUtils"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ShieldOffIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "./AuditReportPanel"
import { auditSideAccent, auditStrip } from "./audit/auditUiStyles"
import { MarkdownRow } from "./MarkdownRow"
import { AuditArtifactQuickLinks } from "./task-header/AuditArtifactQuickLinks"
import { AuditChecklistItems } from "./task-header/AuditChecklistItems"
import { AuditHeaderJumpLink } from "./task-header/AuditHeaderJumpLink"

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
	const reasonLines = useMemo(
		() => buildGateReasonLinesFromMetadata(auditMetadata, qualityGate?.reasonCodes),
		[auditMetadata, qualityGate?.reasonCodes],
	)

	const checklistSummary = useMemo(
		() => buildPreCompletionChecklistSummary(auditMetadata, gateOptions),
		[auditMetadata, gateOptions],
	)
	const failedChecklistItems =
		checklistSummary && "items" in checklistSummary
			? checklistSummary.items.filter((item) => item.status === "fail" || item.status === "warn")
			: []

	return (
		<div className={cn("my-2 lumi-audit-exhale transition-opacity duration-[2s]", auditStrip)}>
			<div className={auditSideAccent}>
				<div className="flex items-start gap-2">
					<ShieldOffIcon className="size-4 text-amber-600/70 dark:text-amber-400/70 shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0 space-y-1.5">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-[10px] font-medium text-amber-800/90 dark:text-amber-300/90">
								Something worth revisiting
							</span>
							{auditMetadata.gate_block_count ? (
								<span className="text-[9px] font-normal text-amber-700/70 dark:text-amber-400/70">
									Note {auditMetadata.gate_block_count}
								</span>
							) : null}
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
									{Number.isFinite(auditMetadata.gate_effective_threshold)
										? ` · threshold ${auditMetadata.gate_effective_threshold}`
										: qualityGate
											? ` · threshold ${qualityGate.effectiveThreshold}`
											: ""}
								</span>
							)}
						</div>

						{reasonLines.length > 0 && (
							<ul className="list-disc list-inside text-[9px] text-amber-800/90 dark:text-amber-300/90 space-y-0.5">
								{reasonLines.map((line) => (
									<li className="break-words" key={line}>
										{line}
									</li>
								))}
							</ul>
						)}

						{failedChecklistItems.length > 0 && (
							<AuditChecklistItems className="pt-0.5" items={failedChecklistItems} />
						)}

						<AuditArtifactQuickLinks auditMetadata={auditMetadata} className="pt-0.5" />

						<AuditHeaderJumpLink className="pt-0.5" label="See details in header" />

						{text && (
							<div className="text-[10px] text-description/80 prose prose-sm max-w-none">
								<MarkdownRow markdown={text} showCursor={false} />
							</div>
						)}

						<button
							aria-expanded={expanded}
							className="text-[9px] font-medium text-amber-700/80 dark:text-amber-400/80 hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer bg-transparent border-0 p-0"
							onClick={() => setExpanded(!expanded)}
							type="button">
							{expanded ? "Hide details" : "Show details"}
						</button>
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

AuditGateBlockRow.displayName = "AuditGateBlockRow"
