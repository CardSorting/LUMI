import { formatGateReasonLabel } from "@shared/audit/auditGateCatalog"
import { buildAuditHealthAnnouncement } from "@shared/audit/auditHealthDigest"
import {
	buildAuditHistoryAnnouncement,
	buildUnifiedAuditExportMarkdown,
	clampAuditFocusIndex,
	extractAuditScoreTimeline,
	getAuditSnapshotKey,
	getLatestGateBlockSnapshot,
	reconcileAuditHistoryState,
	shouldAutoExpandAuditHistory,
	shouldShowAuditHistoryStrip,
} from "@shared/audit/auditHistoryUtils"
import { AUDIT_TREND_LABELS, type AuditMessageSnapshot, getAuditTrend } from "@shared/audit/auditMessages"
import type { PreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { type AuditHealthSummary, computeAuditHealthSummary } from "@shared/audit/auditRollup"
import { partitionViolationsBySeverity } from "@shared/audit/auditSeverity"
import { computeAuditSnapshotDiff } from "@shared/audit/auditSnapshotDiff"
import { AUDIT_HEALTH_TREND_LABELS, AUDIT_SNAPSHOT_SOURCE_LABELS } from "@shared/audit/auditSnapshotLabels"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import { computeTrailingViolationAges } from "@shared/audit/auditViolationAge"
import { getViolationRemediation } from "@shared/audit/auditViolationRemediation"
import { formatAuditTime, formatViolationLabel, HARDENING_GRADE_STYLES } from "@shared/audit/taskAuditUtils"
import type { HardeningGrade } from "@shared/audit/types"
import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "../AuditReportPanel"
import { auditExhaleOpacity } from "../audit/auditUiStyles"
import { AuditScoreSparkline } from "./AuditScoreSparkline"

interface AuditHistoryStripProps {
	snapshots: AuditMessageSnapshot[]
	auditHealth?: AuditHealthSummary
	subagentAuditSummary?: SubagentAuditSummary
	checklistSummary?: PreCompletionChecklistSummary
	onScrollToAuditMessage?: (ts: number) => void
	onScrollToLatestGateBlock?: () => void
	className?: string
}

const SOURCE_LABELS = AUDIT_SNAPSHOT_SOURCE_LABELS

const HEALTH_TREND_LABELS = AUDIT_HEALTH_TREND_LABELS

const SOURCE_CHIP_STYLES: Partial<Record<AuditMessageSnapshot["source"], string>> = {
	gate_block: "border-amber-500/50 text-amber-700 dark:text-amber-400",
	advisory: "border-amber-500/50 text-amber-600 dark:text-amber-400",
}

export const AuditHistoryStrip = memo(
	({
		snapshots,
		auditHealth,
		subagentAuditSummary,
		checklistSummary,
		onScrollToAuditMessage,
		onScrollToLatestGateBlock,
		className,
	}: AuditHistoryStripProps) => {
		const [expanded, setExpanded] = useState(false)
		const [selectedKey, setSelectedKey] = useState<string | null>(null)
		const [focusedIndex, setFocusedIndex] = useState(0)
		const [copied, setCopied] = useState(false)
		const stripRef = useRef<HTMLElement>(null)
		const detailPanelRef = useRef<HTMLDivElement>(null)
		const toggleButtonRef = useRef<HTMLButtonElement>(null)
		const previousSnapshotCountRef = useRef(snapshots.length)

		const snapshotKeys = useMemo(() => snapshots.map(getAuditSnapshotKey), [snapshots])
		const scoreTimeline = useMemo(() => extractAuditScoreTimeline(snapshots), [snapshots])
		const trailingViolationAges = useMemo(() => computeTrailingViolationAges(snapshots), [snapshots])
		const latestGateBlock = useMemo(() => getLatestGateBlockSnapshot(snapshots), [snapshots])
		const health = auditHealth ?? computeAuditHealthSummary(snapshots)

		const handleCopyHistory = useCallback(
			async (event: React.MouseEvent) => {
				event.stopPropagation()
				const markdown = buildUnifiedAuditExportMarkdown({
					snapshots,
					health,
					subagentSummary: subagentAuditSummary,
					checklistSummary,
				})
				try {
					await navigator.clipboard.writeText(markdown)
					setCopied(true)
					window.setTimeout(() => setCopied(false), 2000)
				} catch (error) {
					console.error("Failed to copy audit history:", error)
				}
			},
			[snapshots, health, subagentAuditSummary, checklistSummary],
		)

		useEffect(() => {
			if (shouldAutoExpandAuditHistory(snapshots, previousSnapshotCountRef.current)) {
				setExpanded(true)
			}
			previousSnapshotCountRef.current = snapshots.length
		}, [snapshots])

		useEffect(() => {
			setSelectedKey((selected) => reconcileAuditHistoryState(snapshots, 0, selected).selectedKey)
			setFocusedIndex((focused) => reconcileAuditHistoryState(snapshots, focused, null).focusedIndex)
		}, [snapshots])

		const selectSnapshot = useCallback(
			(index: number) => {
				const key = snapshotKeys[index]
				if (!key) return
				setFocusedIndex(index)
				setSelectedKey((prev) => (prev === key ? null : key))
				if (!expanded) setExpanded(true)
			},
			[snapshotKeys, expanded],
		)

		useEffect(() => {
			if (!expanded) return
			const handleKeyDown = (event: KeyboardEvent) => {
				const inStrip =
					stripRef.current?.contains(document.activeElement) ||
					document.activeElement === stripRef.current ||
					detailPanelRef.current?.contains(document.activeElement)
				if (!inStrip) {
					return
				}
				if (event.key === "ArrowRight" || event.key === "ArrowDown") {
					event.preventDefault()
					setFocusedIndex((i) => clampAuditFocusIndex(i + 1, snapshotKeys.length))
				} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
					event.preventDefault()
					setFocusedIndex((i) => clampAuditFocusIndex(i - 1, snapshotKeys.length))
				} else if (event.key === "Home") {
					event.preventDefault()
					setFocusedIndex(0)
				} else if (event.key === "End") {
					event.preventDefault()
					setFocusedIndex(clampAuditFocusIndex(snapshotKeys.length - 1, snapshotKeys.length))
				} else if (event.key === "Enter" || event.key === " ") {
					event.preventDefault()
					selectSnapshot(focusedIndex)
				} else if (event.key === "Escape") {
					event.preventDefault()
					if (selectedKey) {
						setSelectedKey(null)
					} else {
						setExpanded(false)
						toggleButtonRef.current?.focus()
					}
				} else if (event.key === "Tab" && selectedKey && detailPanelRef.current) {
					const focusable = detailPanelRef.current.querySelectorAll<HTMLElement>(
						'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
					)
					if (focusable.length === 0) return
					const first = focusable[0]
					const last = focusable[focusable.length - 1]
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault()
						last.focus()
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault()
						first.focus()
					}
				}
			}
			document.addEventListener("keydown", handleKeyDown)
			return () => document.removeEventListener("keydown", handleKeyDown)
		}, [expanded, focusedIndex, selectSnapshot, selectedKey, snapshotKeys.length])

		if (!shouldShowAuditHistoryStrip(snapshots, health)) {
			return null
		}

		const selectedSnapshot = selectedKey
			? snapshots.find((snapshot) => getAuditSnapshotKey(snapshot) === selectedKey)
			: undefined

		const liveAnnouncement = selectedSnapshot
			? buildAuditHistoryAnnouncement(selectedSnapshot, SOURCE_LABELS[selectedSnapshot.source])
			: buildAuditHealthAnnouncement(health)

		const latestSnapshot = snapshots[snapshots.length - 1]
		const latestGrade = latestSnapshot.auditMetadata.hardening_grade as HardeningGrade | undefined

		return (
			<section
				aria-label="Task audit history"
				className={cn(
					"mt-2 border-t border-description/8 pt-2 lumi-audit-exhale transition-opacity duration-[2s]",
					className,
				)}
				ref={stripRef}
				tabIndex={expanded ? 0 : -1}>
				<div aria-atomic="true" aria-live="polite" className="sr-only">
					{liveAnnouncement}
				</div>
				<button
					aria-controls="audit-history-details"
					aria-expanded={expanded}
					className="flex w-full items-center justify-between cursor-pointer select-none bg-transparent border-0 p-0 text-left font-sans"
					onClick={() => setExpanded(!expanded)}
					ref={toggleButtonRef}
					type="button">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[10px] text-description/70 font-medium">
							What we've checked ({snapshots.length})
						</span>
						{latestGrade && (
							<span
								className={cn(
									"inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-medium border",
									HARDENING_GRADE_STYLES[latestGrade],
								)}>
								Latest {latestGrade}
								{Number.isFinite(latestSnapshot.auditMetadata.hardening_score) && (
									<span className="font-mono opacity-80 ml-0.5">
										{latestSnapshot.auditMetadata.hardening_score}
									</span>
								)}
							</span>
						)}
						{health && health.trend !== "unknown" && (
							<span className="text-[8px] text-description/60 font-medium">
								{HEALTH_TREND_LABELS[health.trend]}
								{health.averageScore > 0 ? ` · avg ${health.averageScore}` : ""}
								{health.latestScoreDelta !== undefined && health.latestScoreDelta !== 0
									? ` · ${health.latestScoreDelta >= 0 ? "+" : ""}${health.latestScoreDelta} last`
									: ""}
							</span>
						)}
						{health && health.advisorySnapshotCount > 0 && (
							<span className="text-[8px] text-amber-600 dark:text-amber-400 font-medium">
								{health.advisorySnapshotCount} note{health.advisorySnapshotCount === 1 ? "" : "s"}
							</span>
						)}
						{health && health.gateBlockCount > 0 && (
							<span className="text-[8px] text-amber-700 dark:text-amber-400 font-medium">
								{health.gateBlockCount} to revisit
							</span>
						)}
						{health && health.trailingGateBlockStreak > 1 && (
							<span className="text-[8px] text-amber-700 dark:text-amber-400 font-medium">
								{health.trailingGateBlockStreak} in a row
							</span>
						)}
						{health?.planRegressionDetected && (
							<span className="text-[8px] text-amber-600 dark:text-amber-400 font-medium">Plan shifted</span>
						)}
						{health && health.persistentViolationCount > 0 && (
							<span className="text-[8px] text-amber-600/90 font-medium">
								{health.persistentViolationCount} still open
							</span>
						)}
						{trailingViolationAges.size > 0 && Math.max(...trailingViolationAges.values()) > 1 && (
							<span className="text-[8px] text-amber-600/90 font-medium">
								oldest open ×{Math.max(...trailingViolationAges.values())}
							</span>
						)}
						{health && health.suppressedViolationCount > 0 && (
							<span className="text-[8px] text-blue-600/80 font-medium">
								{health.suppressedViolationCount} waived
							</span>
						)}
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<AuditScoreSparkline scores={scoreTimeline} />
						<button
							aria-label="Copy project notes"
							className="inline-flex items-center cursor-pointer bg-transparent border-0 p-0 text-description/60 hover:text-foreground"
							onClick={handleCopyHistory}
							title={copied ? "Copied" : "Copy timeline notes"}
							type="button">
							<CopyIcon className="size-3" />
						</button>
						{expanded ? (
							<ChevronDownIcon className="size-3 text-description/60" />
						) : (
							<ChevronRightIcon className="size-3 text-description/60" />
						)}
					</div>
				</button>

				{latestGateBlock && onScrollToLatestGateBlock && (
					<button
						className="mt-1.5 text-[9px] font-medium text-amber-700/80 dark:text-amber-400/80 hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer bg-transparent border-0 p-0"
						onClick={(event) => {
							event.stopPropagation()
							onScrollToLatestGateBlock()
						}}
						type="button">
						Jump to latest note
					</button>
				)}

				{expanded && (
					<div className="mt-2 space-y-2 animate-lumi-reading-reveal" id="audit-history-details">
						<div aria-label="Audit snapshot grades" className="flex flex-wrap gap-1.5" role="listbox">
							{snapshots.map((snapshot, index) => {
								const grade = snapshot.auditMetadata.hardening_grade as HardeningGrade | undefined
								const previous = index > 0 ? snapshots[index - 1].auditMetadata : undefined
								const trend = getAuditTrend(previous, snapshot.auditMetadata)
								const trendLabel = trend !== "unknown" ? AUDIT_TREND_LABELS[trend] : undefined
								const key = getAuditSnapshotKey(snapshot)
								const isSelected = selectedKey === key
								const isFocused = focusedIndex === index

								return (
									<button
										aria-selected={isSelected}
										className={cn(
											"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-medium border cursor-pointer transition-opacity",
											grade ? HARDENING_GRADE_STYLES[grade] : "border-description/30 text-description/70",
											SOURCE_CHIP_STYLES[snapshot.source],
											isSelected && "ring-1 ring-foreground/40 opacity-100",
											isFocused && !isSelected && "ring-1 ring-foreground/20",
											!isSelected && "opacity-85 hover:opacity-100",
										)}
										key={key}
										onClick={() => selectSnapshot(index)}
										onFocus={() => setFocusedIndex(index)}
										role="option"
										title={
											trendLabel
												? `${SOURCE_LABELS[snapshot.source]} · ${trendLabel}`
												: SOURCE_LABELS[snapshot.source]
										}
										type="button">
										<span className="opacity-70">{SOURCE_LABELS[snapshot.source].slice(0, 1)}</span>
										{grade ?? "?"}
										{Number.isFinite(snapshot.auditMetadata.hardening_score) && (
											<span className="font-mono opacity-80">{snapshot.auditMetadata.hardening_score}</span>
										)}
									</button>
								)
							})}
						</div>

						<div className="space-y-1.5">
							{[...snapshots].reverse().map((snapshot, reverseIndex) => {
								const grade = snapshot.auditMetadata.hardening_grade as HardeningGrade | undefined
								const { critical, warning, info } = partitionViolationsBySeverity(
									snapshot.auditMetadata.violations,
								)
								const key = getAuditSnapshotKey(snapshot)
								const origIndex = snapshots.findIndex((s) => getAuditSnapshotKey(s) === key)
								const previousMetadata = origIndex > 0 ? snapshots[origIndex - 1].auditMetadata : undefined
								const diff = computeAuditSnapshotDiff(previousMetadata, snapshot.auditMetadata)
								return (
									<div
										className={cn(
											"rounded-md border border-description/10 bg-black/[0.015] dark:bg-white/[0.015] p-2 text-[9px] transition-all duration-[2s]",
											auditExhaleOpacity(reverseIndex, selectedKey === key),
											selectedKey === key && "border-description/18 bg-black/[0.025] dark:bg-white/[0.025]",
										)}
										key={`detail-${key}`}>
										<div className="flex items-center justify-between gap-2 mb-1">
											<button
												className={cn(
													"font-medium text-description/80 cursor-pointer bg-transparent border-0 p-0 text-left font-sans text-[9px]",
													selectedKey === key && "text-foreground",
												)}
												onClick={() => setSelectedKey(selectedKey === key ? null : key)}
												type="button">
												{SOURCE_LABELS[snapshot.source]}
											</button>
											<div className="flex items-center gap-2">
												{onScrollToAuditMessage && (
													<button
														className="text-[9px] font-medium text-foreground/70 hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
														onClick={() => onScrollToAuditMessage(snapshot.ts)}
														type="button">
														View in chat
													</button>
												)}
												<span className="font-mono text-description/60">
													{formatAuditTime(snapshot.auditMetadata.audited_at ?? snapshot.ts)}
												</span>
											</div>
										</div>
										<button
											className="w-full text-left bg-transparent border-0 p-0 cursor-pointer font-sans"
											onClick={() => setSelectedKey(selectedKey === key ? null : key)}
											type="button">
											<div className="flex items-center gap-2 flex-wrap">
												{grade && (
													<span
														className={cn(
															"px-1.5 py-0.5 rounded-full font-normal border",
															HARDENING_GRADE_STYLES[grade],
														)}>
														{grade}
													</span>
												)}
												{Number.isFinite(snapshot.auditMetadata.hardening_score) && (
													<span className="font-mono text-description/65">
														{snapshot.auditMetadata.hardening_score}/100
													</span>
												)}
												{critical.length > 0 && (
													<span className="text-amber-700/80 dark:text-amber-400/80 font-normal">
														{critical.length} to revisit
													</span>
												)}
												{warning.length > 0 && (
													<span className="text-amber-600 dark:text-amber-400 font-medium">
														{warning.length} to review
													</span>
												)}
												{info.length > 0 && (
													<span className="text-description/60">{info.length} info</span>
												)}
												{(snapshot.auditMetadata.suppressed_violations?.length ?? 0) > 0 && (
													<span className="text-description/55 font-normal">
														{snapshot.auditMetadata.suppressed_violations?.length} waived
													</span>
												)}
												{snapshot.auditMetadata.workspace_gate_policy_applied && (
													<span className="text-description/55 font-normal">workspace policy</span>
												)}
											</div>
											{snapshot.auditMetadata.gate_reason_codes &&
												snapshot.auditMetadata.gate_reason_codes.length > 0 && (
													<ul className="mt-1 list-disc list-inside text-[8.5px] text-description/65 space-y-0.5">
														{snapshot.auditMetadata.gate_reason_codes
															.filter((code) => code !== "gate_disabled")
															.map((code) => (
																<li className="truncate" key={code}>
																	{formatGateReasonLabel(code)}
																</li>
															))}
													</ul>
												)}
											{(snapshot.auditMetadata.violations?.length ?? 0) > 0 && (
												<ul className="mt-1 list-disc list-inside text-[8.5px] text-description/80 space-y-0.5">
													{snapshot.auditMetadata.violations?.slice(0, 4).map((v) => {
														const hint = getViolationRemediation(v)
														const age = trailingViolationAges.get(v)
														return (
															<li className="truncate font-mono" key={v} title={hint}>
																{formatViolationLabel(v)}
																{age !== undefined && age > 1 && (
																	<span className="ml-1 font-sans font-normal text-amber-600/80 dark:text-amber-400/80">
																		open ×{age}
																	</span>
																)}
																{hint && (
																	<span className="block font-sans font-normal text-description/70 truncate">
																		{hint}
																	</span>
																)}
															</li>
														)
													})}
												</ul>
											)}
											{diff && (diff.newViolations.length > 0 || diff.resolvedViolations.length > 0) && (
												<div className="mt-1 text-[8px] text-description/70 space-y-0.5">
													{diff.scoreDelta !== undefined && (
														<span className="font-mono">
															Score {diff.scoreDelta >= 0 ? "+" : ""}
															{diff.scoreDelta}
														</span>
													)}
													{diff.newViolations.length > 0 && (
														<span className="block text-red-500/90">
															+{diff.newViolations.length} new
														</span>
													)}
													{diff.resolvedViolations.length > 0 && (
														<span className="block text-emerald-600 dark:text-emerald-400">
															−{diff.resolvedViolations.length} resolved
														</span>
													)}
													{diff.persistentViolations.length > 0 && (
														<span className="block text-amber-500/90">
															{diff.persistentViolations.length} persistent
														</span>
													)}
												</div>
											)}
										</button>
									</div>
								)
							})}
						</div>

						{selectedSnapshot && (
							<div
								className="rounded-md border border-description/10 p-1 animate-lumi-reading-reveal opacity-[0.96]"
								ref={detailPanelRef}>
								<AuditReportPanel auditMetadata={selectedSnapshot.auditMetadata} variant="neutral" />
							</div>
						)}
					</div>
				)}
			</section>
		)
	},
)

AuditHistoryStrip.displayName = "AuditHistoryStrip"
