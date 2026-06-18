import { buildCiGateStatusJson } from "@shared/audit/auditCiSummary"
import { formatGateReasonLabel } from "@shared/audit/auditGateCatalog"
import { describeGateReadiness } from "@shared/audit/auditGateReadiness"
import { buildQualityGateStatus } from "@shared/audit/auditGateStatus"
import { buildAuditSarifJson } from "@shared/audit/auditSarifExport"
import { partitionViolationsBySeverity } from "@shared/audit/auditSeverity"
import { getViolationRemediation } from "@shared/audit/auditViolationRemediation"
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
import { StringRequest } from "@shared/proto/dietcode/common"
import { AlertTriangleIcon, CheckIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, ShieldCheckIcon } from "lucide-react"
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import {
	auditBadge,
	auditLabel,
	auditReadingGroup,
	auditReadingRow,
	auditReadingSurface,
	auditSoftDivider,
} from "./audit/auditUiStyles"

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
		? "text-amber-700/80 dark:text-amber-400/80 bg-amber-500/5 border border-amber-500/15"
		: isWarning
			? "text-amber-600/70 dark:text-amber-400/70 bg-amber-500/5 border border-amber-500/10"
			: "text-description/65 bg-black/[0.02] dark:bg-white/[0.02] border border-description/10"
	const label = isCritical ? "Elevated" : isWarning ? "Worth noting" : "Steady"
	return <span className={cn("text-[8px] px-1.5 py-0.5 rounded-full font-normal", badgeClass)}>{label}</span>
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
			className={cn(auditBadge, HARDENING_GRADE_STYLES[grade], "shadow-none tracking-normal")}
			title={Number.isFinite(score) ? `Score ${score}/100` : undefined}>
			Grade {grade}
		</span>
	)
})

HardeningGradeBadge.displayName = "HardeningGradeBadge"

const AuditReadingField = memo(({ label, children }: { label: string; children: ReactNode }) => (
	<div className="min-w-0 flex-1 basis-[9rem] max-w-full">
		<span className={auditLabel}>{label}</span>
		<div className="mt-0.5">{children}</div>
	</div>
))

AuditReadingField.displayName = "AuditReadingField"

export interface AuditReportPanelProps {
	auditMetadata: TaskAuditMetadata
	/** Accent color theme: success (act mode) or neutral (plan mode) */
	variant?: "success" | "neutral"
}

export const AuditReportPanel = memo(({ auditMetadata, variant = "success" }: AuditReportPanelProps) => {
	const [copied, setCopied] = useState(false)
	const [reportCopied, setReportCopied] = useState(false)
	const [sarifCopied, setSarifCopied] = useState(false)
	const [gateStatusCopied, setGateStatusCopied] = useState(false)
	const feedbackTimers = useRef<{
		checksum?: ReturnType<typeof setTimeout>
		report?: ReturnType<typeof setTimeout>
		sarif?: ReturnType<typeof setTimeout>
		gateStatus?: ReturnType<typeof setTimeout>
	}>({})
	const gateOptions = useAuditGateEvaluation(auditMetadata)
	const qualityGate = useMemo(() => buildQualityGateStatus(auditMetadata, gateOptions), [auditMetadata, gateOptions])
	const gateReadiness = useMemo(
		() => (gateOptions.gateEnabled ? describeGateReadiness(auditMetadata, gateOptions) : undefined),
		[auditMetadata, gateOptions],
	)

	useEffect(() => {
		return () => {
			if (feedbackTimers.current.checksum) clearTimeout(feedbackTimers.current.checksum)
			if (feedbackTimers.current.report) clearTimeout(feedbackTimers.current.report)
			if (feedbackTimers.current.sarif) clearTimeout(feedbackTimers.current.sarif)
			if (feedbackTimers.current.gateStatus) clearTimeout(feedbackTimers.current.gateStatus)
		}
	}, [])

	const showCopyFeedback = useCallback((kind: "checksum" | "report" | "sarif" | "gateStatus") => {
		if (feedbackTimers.current[kind]) clearTimeout(feedbackTimers.current[kind])
		if (kind === "checksum") setCopied(true)
		else if (kind === "report") setReportCopied(true)
		else if (kind === "gateStatus") setGateStatusCopied(true)
		else setSarifCopied(true)
		feedbackTimers.current[kind] = setTimeout(() => {
			if (kind === "checksum") setCopied(false)
			else if (kind === "report") setReportCopied(false)
			else if (kind === "gateStatus") setGateStatusCopied(false)
			else setSarifCopied(false)
			feedbackTimers.current[kind] = undefined
		}, COPY_FEEDBACK_DURATION_MS)
	}, [])

	const intentClassification = getIntentClassification(auditMetadata.intent_classification)
	const entropyScore = formatEntropyScore(auditMetadata.entropy_score)
	const intentCoveragePercentage = getIntentCoveragePercentage(auditMetadata.intent_coverage)
	const handleOpenArtifact = useCallback((relativePath: string) => {
		FileServiceClient.openFileRelativePath(StringRequest.create({ value: relativePath })).catch((error) =>
			console.error("Failed to open audit artifact:", error),
		)
	}, [])

	const artifactPaths = [
		auditMetadata.artifact_sarif_path,
		auditMetadata.artifact_report_path,
		auditMetadata.artifact_manifest_path,
	].filter(Boolean) as string[]
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

	const handleCopyGateStatus = async (e: React.MouseEvent) => {
		e.stopPropagation()
		const status = buildQualityGateStatus(auditMetadata, gateOptions)
		if (!status) return
		const payload = buildCiGateStatusJson(auditMetadata, status, "task-audit", "completion")
		if (await copyTextToClipboard(JSON.stringify(payload, null, 2))) showCopyFeedback("gateStatus")
	}

	const borderClass = variant === "success" ? "border-success/10" : "border-description/10"
	const accentText =
		variant === "success" ? "text-success/70 hover:text-success/85" : "text-foreground/70 hover:text-foreground/85"
	const hoverBg = variant === "success" ? "hover:bg-success/[0.03]" : "hover:bg-foreground/[0.03]"

	return (
		<details
			className={cn(
				"lumi-inline-disclosure group mt-3 border-t pt-3 text-[11px] font-sans lumi-audit-exhale transition-opacity duration-[2s]",
				borderClass,
			)}>
			<summary
				className={cn(
					"lumi-details-trigger flex w-full items-center justify-between cursor-pointer select-none transition-colors py-1 px-1 rounded-sm list-none",
					accentText,
					hoverBg,
				)}>
				<div className="flex items-center gap-1.5 font-medium text-[9px] text-description/65 min-w-0">
					<ShieldCheckIcon
						className={cn("size-3 shrink-0", variant === "success" ? "text-success/70" : "text-description/60")}
					/>
					<span>Quality notes</span>
					<HardeningGradeBadge grade={auditMetadata.hardening_grade} score={auditMetadata.hardening_score} />
				</div>
				<ChevronRightIcon aria-hidden className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
			</summary>

			<div className={cn(auditReadingSurface, "lumi-workshop-haze mt-1")}>
				<div className={auditReadingRow}>
					<AuditReadingField label="Intent">
						<span
							className={cn(
								"inline-flex px-1.5 py-0.5 rounded-full text-[8px] font-normal",
								INTENT_CLASSIFICATION_STYLES[intentClassification],
							)}>
							{intentClassification}
						</span>
					</AuditReadingField>
					<AuditReadingField label="Grade">
						<div className="flex items-center gap-1.5 flex-wrap">
							<HardeningGradeBadge grade={auditMetadata.hardening_grade} score={auditMetadata.hardening_score} />
							{Number.isFinite(auditMetadata.hardening_score) && (
								<span className="font-mono text-[9px] text-description/60">
									{auditMetadata.hardening_score}/100
								</span>
							)}
						</div>
					</AuditReadingField>
					<AuditReadingField label="Alignment">
						{auditMetadata.divergence_detected ? (
							<span
								className={cn(
									auditBadge,
									"inline-flex items-center gap-1 text-amber-700/75 dark:text-amber-400/75",
								)}>
								<AlertTriangleIcon className="size-2" /> Some drift
							</span>
						) : (
							<span className={cn(auditBadge, "inline-flex items-center gap-1")}>
								<ShieldCheckIcon className="size-2" /> Aligned
							</span>
						)}
					</AuditReadingField>
				</div>

				<div className={auditReadingRow}>
					<AuditReadingField label="Intent coverage">
						<div className="flex items-center gap-2">
							<div className="w-14 h-1 rounded-full overflow-hidden bg-black/[0.04] dark:bg-white/[0.04]">
								<div
									className={cn(
										"h-full transition-all duration-700",
										variant === "success" ? "bg-success/60" : "bg-foreground/40",
									)}
									style={{ width: `${intentCoveragePercentage}%` }}
								/>
							</div>
							<span className="font-mono text-[9px] text-description/60">{intentCoveragePercentage}%</span>
						</div>
					</AuditReadingField>
					<AuditReadingField label="Structural entropy">
						<div className="flex items-center gap-1.5 font-mono text-[10px] text-description/65">
							<span>{entropyScore}</span>
							<EntropyBadge score={auditMetadata.entropy_score} />
						</div>
					</AuditReadingField>
					<AuditReadingField label="Checked at">
						<span className="font-mono text-[9px] text-description/60">{auditTime}</span>
						{auditMetadata.workspace_gate_policy_applied && (
							<span className={cn("mt-1 inline-flex", auditBadge, "text-description/55")}>Workspace policy</span>
						)}
					</AuditReadingField>
				</div>

				<div className={auditReadingRow}>
					<AuditReadingField label="Checksum">
						<div className="flex items-center gap-1">
							<span
								className="font-mono text-[9px] px-1.5 py-0.5 rounded-md truncate max-w-[100px] text-description/65 bg-black/[0.03] dark:bg-white/[0.03]"
								title={auditMetadata.result_checksum}>
								{auditMetadata.result_checksum ? auditMetadata.result_checksum.substring(0, 10) : "N/A"}
							</span>
							{auditMetadata.result_checksum && (
								<button
									aria-label="Copy checksum"
									className={cn(
										"p-0.5 rounded-xs transition-colors cursor-pointer opacity-60 hover:opacity-100",
										accentText,
									)}
									onClick={(e) => handleCopyChecksum(e, auditMetadata.result_checksum as string)}
									type="button">
									{copied ? (
										<CheckIcon className="size-3 text-emerald-500/80" />
									) : (
										<CopyIcon className="size-3" />
									)}
								</button>
							)}
						</div>
					</AuditReadingField>
				</div>

				{gateReadiness && gateReadiness.level !== "disabled" && (
					<div className={cn(auditReadingGroup, auditSoftDivider)}>
						<span className={auditLabel}>Quality check</span>
						<span
							className={cn(
								"mt-0.5 w-fit px-1.5 py-0.5 rounded-full text-[8px] font-normal border",
								gateReadiness.level === "ready" &&
									"bg-black/[0.02] dark:bg-white/[0.02] text-description/70 border-description/10",
								gateReadiness.level === "warning" &&
									"bg-amber-500/8 text-amber-700/80 dark:text-amber-400/80 border-amber-500/15",
								gateReadiness.level === "blocked" &&
									"bg-amber-500/8 text-amber-700/80 dark:text-amber-400/80 border-amber-500/15",
							)}>
							{gateReadiness.label}
							{qualityGate ? ` · ${qualityGate.score}/${qualityGate.effectiveThreshold}` : ""}
						</span>
						{gateReadiness.tooltip && (
							<span className="text-[8.5px] text-description/70">{gateReadiness.tooltip}</span>
						)}
					</div>
				)}

				{auditMetadata.gate_blocked && (
					<div className={cn(auditReadingGroup, auditSoftDivider)}>
						<span className={auditLabel}>Before finishing</span>
						<span className="text-[9px] text-amber-700/80 dark:text-amber-400/80">
							Paused
							{auditMetadata.gate_block_count ? ` · attempt ${auditMetadata.gate_block_count}` : ""}
							{Number.isFinite(auditMetadata.gate_effective_threshold)
								? ` · threshold ${auditMetadata.gate_effective_threshold}`
								: ""}
						</span>
						{auditMetadata.gate_reason_codes && auditMetadata.gate_reason_codes.length > 0 && (
							<ul className="list-disc list-inside text-[9px] text-description/70 space-y-0.5">
								{auditMetadata.gate_reason_codes
									.filter((code) => code !== "gate_disabled")
									.map((code) => (
										<li key={code}>{formatGateReasonLabel(code)}</li>
									))}
							</ul>
						)}
					</div>
				)}

				<div className={cn(auditReadingGroup, auditSoftDivider)}>
					{auditMetadata.violations && auditMetadata.violations.length > 0 ? (
						<div className="w-full">
							<div className="flex items-center gap-1 text-amber-700/80 dark:text-amber-400/80 font-medium text-[9px] mb-1.5">
								<AlertTriangleIcon className="size-3" />
								<span>Things to revisit ({auditMetadata.violations.length})</span>
								{violationSeverity.critical.length > 0 && (
									<span className="ml-1 px-1 py-0.5 rounded-full text-[8px] font-normal bg-amber-500/8 border border-amber-500/12 text-amber-700/80 dark:text-amber-400/80">
										{violationSeverity.critical.length} notable
									</span>
								)}
								{violationSeverity.warning.length > 0 && (
									<span className="px-1 py-0.5 rounded-full text-[8px] font-normal bg-black/[0.02] dark:bg-white/[0.02] border border-description/10 text-description/65">
										{violationSeverity.warning.length} minor
									</span>
								)}
							</div>
							<ul className="mt-1 list-disc list-inside text-[9.5px] text-description/75 space-y-1 bg-black/[0.02] dark:bg-white/[0.02] p-2 rounded-md">
								{auditMetadata.violations.map((v) => {
									const hint = getViolationRemediation(v)
									return (
										<li className="font-mono" key={v} title={v}>
											<span className="font-normal font-sans">{formatViolationLabel(v)}</span>
											{hint && (
												<span className="block text-[9px] text-description/60 font-sans font-normal mt-0.5 pl-3">
													{hint}
												</span>
											)}
										</li>
									)
								})}
							</ul>
						</div>
					) : (
						<div className="flex items-center gap-1.5 text-description/65 bg-black/[0.02] dark:bg-white/[0.02] px-2.5 py-1.5 rounded-md w-full">
							<CheckIcon className="size-3.5" />
							<span className="font-normal text-[9.5px]">Nothing flagged</span>
						</div>
					)}
				</div>

				{auditMetadata.joy_zoning_violations && auditMetadata.joy_zoning_violations.length > 0 && (
					<div className={cn(auditReadingGroup, auditSoftDivider)}>
						<div className="flex items-center gap-1 text-amber-600/80 dark:text-amber-400/80 font-medium text-[9px] mb-1.5">
							<AlertTriangleIcon className="size-3" /> Layer observations
						</div>
						<ul className="list-disc list-inside text-[9.5px] text-description/75 space-y-1 bg-black/[0.02] dark:bg-white/[0.02] p-2 rounded-md">
							{auditMetadata.joy_zoning_violations.map((v) => (
								<li className="truncate font-mono" key={v}>
									{v}
								</li>
							))}
						</ul>
					</div>
				)}

				{(auditMetadata.suppressed_violations?.length ?? 0) > 0 && (
					<div className={cn(auditReadingGroup, auditSoftDivider)}>
						<span className={auditLabel}>Waived observations</span>
						<ul className="list-disc list-inside text-[8.5px] text-description/70 space-y-0.5">
							{auditMetadata.suppressed_violations?.map((violation) => (
								<li className="font-mono truncate" key={violation}>
									{formatViolationLabel(violation)}
								</li>
							))}
						</ul>
					</div>
				)}

				{artifactPaths.length > 0 && (
					<div className={cn(auditReadingGroup, auditSoftDivider)}>
						<span className={auditLabel}>Saved files</span>
						<ul className="list-none text-[9px] font-mono text-description/80 space-y-1">
							{artifactPaths.map((artifactPath) => (
								<li className="flex items-center justify-between gap-2" key={artifactPath}>
									<span className="truncate" title={artifactPath}>
										{artifactPath}
									</span>
									<button
										aria-label={`Open ${artifactPath}`}
										className={cn(
											"inline-flex items-center gap-1 shrink-0 cursor-pointer bg-transparent border-0 p-0",
											accentText,
										)}
										onClick={(event) => {
											event.stopPropagation()
											handleOpenArtifact(artifactPath)
										}}
										type="button">
										<ExternalLinkIcon className="size-2.5" />
										<span>Open</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				)}

				{auditReportId && (
					<div
						className={cn(
							auditReadingGroup,
							auditSoftDivider,
							"flex items-center justify-between gap-2 text-[9px] text-description/45 font-mono flex-wrap",
						)}>
						<span>Note ref · {auditReportId}</span>
						<div className="flex items-center gap-2">
							<button
								aria-label="Copy project notes"
								className={cn(
									"flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-0 opacity-70 hover:opacity-100",
									accentText,
								)}
								onClick={handleCopyReport}
								type="button">
								{reportCopied ? (
									<>
										<CheckIcon className="size-3 text-emerald-500/80" />
										<span>Copied</span>
									</>
								) : (
									<>
										<CopyIcon className="size-3" />
										<span>Project notes</span>
									</>
								)}
							</button>
							<button
								aria-label="Copy detailed notes"
								className={cn(
									"flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-0 opacity-70 hover:opacity-100",
									accentText,
								)}
								onClick={handleCopyGateStatus}
								type="button">
								{gateStatusCopied ? (
									<>
										<CheckIcon className="size-3 text-emerald-500/80" />
										<span>Copied</span>
									</>
								) : (
									<>
										<CopyIcon className="size-3" />
										<span>Detailed notes</span>
									</>
								)}
							</button>
							<button
								aria-label="Copy tool report"
								className={cn(
									"flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-0 opacity-70 hover:opacity-100",
									accentText,
								)}
								onClick={handleCopySarif}
								type="button">
								{sarifCopied ? (
									<>
										<CheckIcon className="size-3 text-emerald-500/80" />
										<span>Copied</span>
									</>
								) : (
									<>
										<CopyIcon className="size-3" />
										<span>Tool report</span>
									</>
								)}
							</button>
						</div>
					</div>
				)}
			</div>
		</details>
	)
})

AuditReportPanel.displayName = "AuditReportPanel"
