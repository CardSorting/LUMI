import { formatGateReasonLabel } from "@shared/audit/auditGateCatalog"
import { buildAuditSarifJson } from "@shared/audit/auditSarifExport"
import { partitionViolationsBySeverity } from "@shared/audit/auditSeverity"
import { getViolationRemediation } from "@shared/audit/completionAudit"
import {
	buildAuditReportMarkdown,
	formatAuditTime,
	formatEntropyScore,
	formatViolationLabel,
	getAuditReportId,
	getIntentClassification,
	getIntentCoveragePercentage,
	HARDENING_GRADE_STYLES,
	INTENT_CLASSIFICATION_STYLES,
} from "@shared/audit/taskAuditUtils"
import { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, ShieldCheckIcon } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const COPY_FEEDBACK_DURATION_MS = 2000

const copyTextToClipboard = async (text: string): Promise<boolean> => {
	if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
		return false
	}
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch (error) {
		console.error("Failed to copy audit metadata:", error)
		return false
	}
}

interface EntropyBadgeProps {
	score?: number
}

const EntropyBadge = memo(({ score = 0 }: EntropyBadgeProps) => {
	const isCritical = score > 0.6
	const isWarning = score > 0.4
	const badgeClass = isCritical
		? "text-red-500 bg-red-500/10 border border-red-500/20"
		: isWarning
			? "text-amber-500 bg-amber-500/10 border border-amber-500/20"
			: "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20"
	const label = isCritical ? "CRITICAL" : isWarning ? "WARNING" : "STABLE"
	return <span className={cn("text-[8px] px-1 rounded-xs font-sans font-extrabold tracking-wider", badgeClass)}>{label}</span>
})

EntropyBadge.displayName = "EntropyBadge"

interface HardeningGradeBadgeProps {
	grade?: TaskAuditMetadata["hardening_grade"]
	score?: number
}

const HardeningGradeBadge = memo(({ grade, score }: HardeningGradeBadgeProps) => {
	if (!grade) return null
	return (
		<span
			className={cn(
				"px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest shadow-sm",
				HARDENING_GRADE_STYLES[grade],
			)}
			title={Number.isFinite(score) ? `Hardening score: ${score}/100` : undefined}>
			Grade {grade}
		</span>
	)
})

HardeningGradeBadge.displayName = "HardeningGradeBadge"

export interface AuditReportPanelProps {
	auditMetadata: TaskAuditMetadata
	/** Accent color theme: success (act mode) or neutral (plan mode) */
	variant?: "success" | "neutral"
}

export const AuditReportPanel = memo(({ auditMetadata, variant = "success" }: AuditReportPanelProps) => {
	const [isAuditExpanded, setIsAuditExpanded] = useState(false)
	const [copied, setCopied] = useState(false)
	const [reportCopied, setReportCopied] = useState(false)
	const [sarifCopied, setSarifCopied] = useState(false)
	const feedbackTimers = useRef<{
		checksum?: ReturnType<typeof setTimeout>
		report?: ReturnType<typeof setTimeout>
		sarif?: ReturnType<typeof setTimeout>
	}>({})

	useEffect(() => {
		return () => {
			if (feedbackTimers.current.checksum) clearTimeout(feedbackTimers.current.checksum)
			if (feedbackTimers.current.report) clearTimeout(feedbackTimers.current.report)
			if (feedbackTimers.current.sarif) clearTimeout(feedbackTimers.current.sarif)
		}
	}, [])

	const showCopyFeedback = useCallback((kind: "checksum" | "report" | "sarif") => {
		if (feedbackTimers.current[kind]) clearTimeout(feedbackTimers.current[kind])
		if (kind === "checksum") setCopied(true)
		else if (kind === "report") setReportCopied(true)
		else setSarifCopied(true)
		feedbackTimers.current[kind] = setTimeout(() => {
			if (kind === "checksum") setCopied(false)
			else if (kind === "report") setReportCopied(false)
			else setSarifCopied(false)
			feedbackTimers.current[kind] = undefined
		}, COPY_FEEDBACK_DURATION_MS)
	}, [])

	const intentClassification = getIntentClassification(auditMetadata.intent_classification)
	const entropyScore = formatEntropyScore(auditMetadata.entropy_score)
	const intentCoveragePercentage = getIntentCoveragePercentage(auditMetadata.intent_coverage)
	const auditTime = formatAuditTime(auditMetadata.audited_at)
	const auditReportId = getAuditReportId(auditMetadata.audited_at)
	const violationSeverity = partitionViolationsBySeverity(auditMetadata.violations)

	const handleCopyChecksum = async (e: React.MouseEvent, checksum: string) => {
		e.stopPropagation()
		if (await copyTextToClipboard(checksum)) showCopyFeedback("checksum")
	}

	const handleCopyReport = async (e: React.MouseEvent) => {
		e.stopPropagation()
		if (await copyTextToClipboard(buildAuditReportMarkdown(auditMetadata))) showCopyFeedback("report")
	}

	const handleCopySarif = async (e: React.MouseEvent) => {
		e.stopPropagation()
		if (await copyTextToClipboard(buildAuditSarifJson(auditMetadata))) showCopyFeedback("sarif")
	}

	const borderClass = variant === "success" ? "border-success/20" : "border-description/30"
	const accentText = variant === "success" ? "text-success/80 hover:text-success" : "text-foreground/80 hover:text-foreground"
	const panelBorder = variant === "success" ? "border-success/15" : "border-description/20"
	const hoverBg = variant === "success" ? "hover:bg-success/5" : "hover:bg-foreground/5"

	return (
		<div className={cn("mt-3 border-t pt-3 text-[11px] font-sans", borderClass)}>
			<button
				aria-expanded={isAuditExpanded}
				aria-label="Toggle architectural hardening report"
				className={cn(
					"flex w-full items-center justify-between cursor-pointer select-none transition-colors py-1 px-1 rounded-sm border-0 bg-transparent text-left outline-none font-sans",
					accentText,
					hoverBg,
				)}
				onClick={() => setIsAuditExpanded(!isAuditExpanded)}
				type="button">
				<div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[9px]">
					<ShieldCheckIcon
						className={cn("size-3 animate-pulse", variant === "success" ? "text-success" : "text-foreground")}
					/>
					<span>Architectural Hardening Report</span>
					<HardeningGradeBadge grade={auditMetadata.hardening_grade} score={auditMetadata.hardening_score} />
				</div>
				{isAuditExpanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
			</button>

			{isAuditExpanded && (
				<div
					className={cn(
						"mt-2.5 grid grid-cols-2 gap-2.5 bg-black/10 dark:bg-white/5 p-3 rounded-sm border animate-fadeIn",
						panelBorder,
					)}>
					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Intent Classification
						</span>
						<span
							className={cn(
								"mt-0.5 w-fit px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest shadow-sm",
								INTENT_CLASSIFICATION_STYLES[intentClassification],
							)}>
							{intentClassification}
						</span>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Hardening Grade
						</span>
						<div className="mt-0.5 flex items-center gap-1.5">
							<HardeningGradeBadge grade={auditMetadata.hardening_grade} score={auditMetadata.hardening_score} />
							{Number.isFinite(auditMetadata.hardening_score) && (
								<span className="font-mono text-[9px] font-bold">{auditMetadata.hardening_score}/100</span>
							)}
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Result Checksum
						</span>
						<div className="flex items-center gap-1 mt-0.5">
							<span
								className={cn(
									"font-mono text-[9px] px-1.5 py-0.5 rounded-xs truncate max-w-[100px]",
									variant === "success"
										? "text-success/90 bg-success/10"
										: "text-foreground/90 bg-foreground/10",
								)}
								title={auditMetadata.result_checksum}>
								{auditMetadata.result_checksum ? auditMetadata.result_checksum.substring(0, 10) : "N/A"}
							</span>
							{auditMetadata.result_checksum && (
								<button
									aria-label="Copy checksum"
									className={cn("p-0.5 rounded-xs transition-colors cursor-pointer", accentText)}
									onClick={(e) => handleCopyChecksum(e, auditMetadata.result_checksum as string)}
									type="button">
									{copied ? <CheckIcon className="size-3 text-emerald-500" /> : <CopyIcon className="size-3" />}
								</button>
							)}
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Structural Entropy
						</span>
						<div className="flex items-center gap-1.5 mt-0.5 font-mono text-[10px]">
							<span className="font-bold">{entropyScore}</span>
							<EntropyBadge score={auditMetadata.entropy_score} />
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Intent Coverage
						</span>
						<div className="flex items-center gap-2 mt-1">
							<div
								className={cn(
									"w-16 h-1.5 rounded-full overflow-hidden border",
									variant === "success"
										? "bg-success/20 border-success/10"
										: "bg-foreground/20 border-foreground/10",
								)}>
								<div
									className={cn(
										"h-full transition-all duration-500",
										variant === "success" ? "bg-success" : "bg-foreground",
									)}
									style={{ width: `${intentCoveragePercentage}%` }}
								/>
							</div>
							<span className="font-mono text-[9px] font-bold">{intentCoveragePercentage}%</span>
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Alignment Status
						</span>
						{auditMetadata.divergence_detected ? (
							<span className="mt-0.5 w-fit px-1.5 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-widest bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 flex items-center gap-1">
								<AlertTriangleIcon className="size-2 animate-pulse" /> Divergent
							</span>
						) : (
							<span className="mt-0.5 w-fit px-1.5 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-widest bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
								<ShieldCheckIcon className="size-2" /> Aligned
							</span>
						)}
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
							Audit Timestamp
						</span>
						<span className="mt-0.5 font-mono text-[9px]">{auditTime}</span>
					</div>

					{auditMetadata.gate_blocked && (
						<div className="col-span-2 flex flex-col gap-1 border-t border-description/10 pt-2">
							<span className="text-[9px] uppercase tracking-wider text-red-500 font-semibold">
								Completion Gate
							</span>
							<span className="text-[9px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
								Blocked
								{auditMetadata.gate_block_count ? ` · Attempt ${auditMetadata.gate_block_count}` : ""}
								{Number.isFinite(auditMetadata.gate_effective_threshold)
									? ` · Threshold ${auditMetadata.gate_effective_threshold}`
									: ""}
							</span>
							{auditMetadata.gate_reason_codes && auditMetadata.gate_reason_codes.length > 0 && (
								<ul className="list-disc list-inside text-[9px] text-red-500/90 space-y-0.5">
									{auditMetadata.gate_reason_codes
										.filter((code) => code !== "gate_disabled")
										.map((code) => (
											<li key={code}>{formatGateReasonLabel(code)}</li>
										))}
								</ul>
							)}
						</div>
					)}

					<div className="col-span-2 mt-1 border-t border-description/10 pt-2.5">
						{auditMetadata.violations && auditMetadata.violations.length > 0 ? (
							<div className="w-full">
								<div className="flex items-center gap-1 text-red-500 font-extrabold text-[9px] uppercase tracking-wider">
									<AlertTriangleIcon className="size-3 animate-bounce" />
									<span>Policy Violations ({auditMetadata.violations.length})</span>
									{violationSeverity.critical.length > 0 && (
										<span className="ml-1 px-1 py-0.5 rounded-xs bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30">
											{violationSeverity.critical.length} critical
										</span>
									)}
									{violationSeverity.warning.length > 0 && (
										<span className="px-1 py-0.5 rounded-xs bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
											{violationSeverity.warning.length} warning
										</span>
									)}
								</div>
								<ul className="mt-1.5 list-disc list-inside text-[9.5px] text-red-600 dark:text-red-400 space-y-1 bg-red-500/5 p-2 rounded-xs border border-red-500/15">
									{auditMetadata.violations.map((v) => {
										const hint = getViolationRemediation(v)
										return (
											<li className="font-mono" key={v} title={v}>
												<span className="font-bold">{formatViolationLabel(v)}</span>
												{hint && (
													<span className="block text-[9px] text-red-500/80 font-sans font-normal mt-0.5 pl-3">
														{hint}
													</span>
												)}
											</li>
										)
									})}
								</ul>
							</div>
						) : (
							<div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-2.5 py-1.5 rounded-xs border border-emerald-500/15 w-full">
								<CheckIcon className="size-3.5 stroke-[3]" />
								<span className="font-bold text-[9.5px] uppercase tracking-wider">
									0 Violations — Fully Hardened
								</span>
							</div>
						)}
					</div>

					{auditMetadata.joy_zoning_violations && auditMetadata.joy_zoning_violations.length > 0 && (
						<div className="col-span-2 mt-1 border-t border-description/10 pt-2.5">
							<div className="flex items-center gap-1 text-amber-500 font-extrabold text-[9px] uppercase tracking-wider mb-1.5">
								<AlertTriangleIcon className="size-3" /> Architecture Layer Violations
							</div>
							<ul className="list-disc list-inside text-[9.5px] text-amber-600 dark:text-amber-400 space-y-1 bg-amber-500/5 p-2 rounded-xs border border-amber-500/15">
								{auditMetadata.joy_zoning_violations.map((v) => (
									<li className="truncate font-mono" key={v}>
										{v}
									</li>
								))}
							</ul>
						</div>
					)}

					{(auditMetadata.artifact_sarif_path ||
						auditMetadata.artifact_report_path ||
						auditMetadata.artifact_manifest_path) && (
						<div className="col-span-2 flex flex-col gap-1 border-t border-description/10 pt-2">
							<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
								Workspace Artifacts
							</span>
							<ul className="list-none text-[9px] font-mono text-description/80 space-y-0.5">
								{auditMetadata.artifact_sarif_path && (
									<li title={auditMetadata.artifact_sarif_path}>{auditMetadata.artifact_sarif_path}</li>
								)}
								{auditMetadata.artifact_report_path && (
									<li title={auditMetadata.artifact_report_path}>{auditMetadata.artifact_report_path}</li>
								)}
								{auditMetadata.artifact_manifest_path && (
									<li title={auditMetadata.artifact_manifest_path}>{auditMetadata.artifact_manifest_path}</li>
								)}
							</ul>
						</div>
					)}

					{auditReportId && (
						<div className="col-span-2 mt-1 border-t border-description/10 pt-2 flex items-center justify-between gap-2 text-[9px] text-description/60 font-mono flex-wrap">
							<span>Report ID: {auditReportId}</span>
							<div className="flex items-center gap-2">
								<button
									aria-label="Copy audit report"
									className={cn(
										"flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-0",
										accentText,
									)}
									onClick={handleCopyReport}
									type="button">
									{reportCopied ? (
										<>
											<CheckIcon className="size-3 text-emerald-500" />
											<span>Copied!</span>
										</>
									) : (
										<>
											<CopyIcon className="size-3" />
											<span>Markdown</span>
										</>
									)}
								</button>
								<button
									aria-label="Copy SARIF report"
									className={cn(
										"flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-0",
										accentText,
									)}
									onClick={handleCopySarif}
									type="button">
									{sarifCopied ? (
										<>
											<CheckIcon className="size-3 text-emerald-500" />
											<span>Copied!</span>
										</>
									) : (
										<>
											<CopyIcon className="size-3" />
											<span>SARIF</span>
										</>
									)}
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	)
})

AuditReportPanel.displayName = "AuditReportPanel"
