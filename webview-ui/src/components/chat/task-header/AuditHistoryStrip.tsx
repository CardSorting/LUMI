import { formatGateReasonLabel } from "@shared/audit/auditGateCatalog"
import { AUDIT_TREND_LABELS, type AuditMessageSnapshot, getAuditTrend } from "@shared/audit/auditMessages"
import { computeAuditHealthSummary } from "@shared/audit/auditRollup"
import { partitionViolationsBySeverity } from "@shared/audit/auditSeverity"
import { formatAuditTime, formatViolationLabel, HARDENING_GRADE_STYLES } from "@shared/audit/taskAuditUtils"
import type { HardeningGrade } from "@shared/audit/types"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "../AuditReportPanel"

interface AuditHistoryStripProps {
	snapshots: AuditMessageSnapshot[]
	onScrollToAuditMessage?: (ts: number) => void
	className?: string
}

const SOURCE_LABELS: Record<AuditMessageSnapshot["source"], string> = {
	completion: "Completion",
	plan: "Plan",
	gate_block: "Gate Block",
}

const SOURCE_CHIP_STYLES: Partial<Record<AuditMessageSnapshot["source"], string>> = {
	gate_block: "border-red-500/50 text-red-600 dark:text-red-400",
}

const HEALTH_TREND_LABELS = {
	improving: "Improving",
	degrading: "Degrading",
	stable: "Stable",
	unknown: "",
} as const

export const AuditHistoryStrip = memo(({ snapshots, onScrollToAuditMessage, className }: AuditHistoryStripProps) => {
	const [expanded, setExpanded] = useState(false)
	const [selectedKey, setSelectedKey] = useState<string | null>(null)
	const [focusedIndex, setFocusedIndex] = useState(0)
	const stripRef = useRef<HTMLDivElement>(null)
	const detailPanelRef = useRef<HTMLDivElement>(null)
	const toggleButtonRef = useRef<HTMLButtonElement>(null)

	const snapshotKeys = snapshots.map((s) => `${s.ts}-${s.source}`)

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
				setFocusedIndex((i) => Math.min(snapshotKeys.length - 1, i + 1))
			} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
				event.preventDefault()
				setFocusedIndex((i) => Math.max(0, i - 1))
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

	if (snapshots.length <= 1) {
		return null
	}

	const health = computeAuditHealthSummary(snapshots)
	const selectedSnapshot = selectedKey ? snapshots.find((s) => `${s.ts}-${s.source}` === selectedKey) : undefined

	const liveAnnouncement = selectedSnapshot
		? `Selected ${SOURCE_LABELS[selectedSnapshot.source]} audit grade ${selectedSnapshot.auditMetadata.hardening_grade ?? "unknown"}`
		: ""

	return (
		<div
			aria-label="Task audit history"
			className={cn("mt-2 border-t border-description/15 pt-2", className)}
			ref={stripRef}
			role="region"
			tabIndex={expanded ? 0 : -1}>
			<div aria-atomic="true" aria-live="polite" className="sr-only">
				{liveAnnouncement}
			</div>
			<button
				aria-controls="audit-history-panel"
				aria-expanded={expanded}
				className="flex w-full items-center justify-between cursor-pointer select-none bg-transparent border-0 p-0 text-left font-sans"
				onClick={() => setExpanded(!expanded)}
				ref={toggleButtonRef}
				type="button">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
						Audit History ({snapshots.length})
					</span>
					{health && health.trend !== "unknown" && (
						<span className="text-[8px] uppercase tracking-wider text-description/60 font-bold">
							{HEALTH_TREND_LABELS[health.trend]} · avg {health.averageScore}
						</span>
					)}
					{health && health.gateBlockCount > 0 && (
						<span className="text-[8px] uppercase tracking-wider text-red-500 font-bold">
							{health.gateBlockCount} gate block{health.gateBlockCount === 1 ? "" : "s"}
						</span>
					)}
					{health && health.suppressedViolationCount > 0 && (
						<span className="text-[8px] uppercase tracking-wider text-blue-500/80 font-bold">
							{health.suppressedViolationCount} waived
						</span>
					)}
				</div>
				{expanded ? (
					<ChevronDownIcon className="size-3 text-description/60" />
				) : (
					<ChevronRightIcon className="size-3 text-description/60" />
				)}
			</button>

			<div
				aria-label="Audit snapshot grades"
				className="flex flex-wrap gap-1.5 mt-1.5"
				id="audit-history-panel"
				role="listbox">
				{snapshots.map((snapshot, index) => {
					const grade = snapshot.auditMetadata.hardening_grade as HardeningGrade | undefined
					const previous = index > 0 ? snapshots[index - 1].auditMetadata : undefined
					const trend = getAuditTrend(previous, snapshot.auditMetadata)
					const trendLabel = trend !== "unknown" ? AUDIT_TREND_LABELS[trend] : undefined
					const key = `${snapshot.ts}-${snapshot.source}`
					const isSelected = selectedKey === key
					const isFocused = expanded && focusedIndex === index

					return (
						<button
							aria-selected={isSelected}
							className={cn(
								"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border cursor-pointer transition-opacity",
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
								trendLabel ? `${SOURCE_LABELS[snapshot.source]} · ${trendLabel}` : SOURCE_LABELS[snapshot.source]
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

			{expanded && (
				<div className="mt-2 space-y-1.5 animate-fadeIn">
					{[...snapshots].reverse().map((snapshot) => {
						const grade = snapshot.auditMetadata.hardening_grade as HardeningGrade | undefined
						const { critical, warning, info } = partitionViolationsBySeverity(snapshot.auditMetadata.violations)
						const key = `${snapshot.ts}-${snapshot.source}`
						return (
							<div
								className={cn(
									"rounded-xs border border-description/15 bg-black/5 dark:bg-white/5 p-2 text-[9px] cursor-pointer transition-colors",
									selectedKey === key && "border-foreground/30 bg-black/10 dark:bg-white/10",
								)}
								key={`detail-${key}`}
								onClick={() => setSelectedKey(selectedKey === key ? null : key)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault()
										setSelectedKey(selectedKey === key ? null : key)
									}
								}}
								role="button"
								tabIndex={0}>
								<div className="flex items-center justify-between gap-2 mb-1">
									<span className="font-bold uppercase tracking-wider text-description/80">
										{SOURCE_LABELS[snapshot.source]}
									</span>
									<div className="flex items-center gap-2">
										{onScrollToAuditMessage && (
											<button
												className="text-[8px] uppercase tracking-wider font-bold text-foreground/70 hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
												onClick={(e) => {
													e.stopPropagation()
													onScrollToAuditMessage(snapshot.ts)
												}}
												type="button">
												View in chat
											</button>
										)}
										<span className="font-mono text-description/60">
											{formatAuditTime(snapshot.auditMetadata.audited_at ?? snapshot.ts)}
										</span>
									</div>
								</div>
								<div className="flex items-center gap-2 flex-wrap">
									{grade && (
										<span
											className={cn(
												"px-1.5 py-0.5 rounded-full font-extrabold border",
												HARDENING_GRADE_STYLES[grade],
											)}>
											{grade}
										</span>
									)}
									{Number.isFinite(snapshot.auditMetadata.hardening_score) && (
										<span className="font-mono font-bold">{snapshot.auditMetadata.hardening_score}/100</span>
									)}
									{critical.length > 0 && (
										<span className="text-red-500 font-bold">{critical.length} critical</span>
									)}
									{warning.length > 0 && (
										<span className="text-amber-500 font-bold">{warning.length} warning</span>
									)}
									{info.length > 0 && <span className="text-description/60">{info.length} info</span>}
									{(snapshot.auditMetadata.suppressed_violations?.length ?? 0) > 0 && (
										<span className="text-blue-500/80 font-bold">
											{snapshot.auditMetadata.suppressed_violations!.length} waived
										</span>
									)}
									{snapshot.auditMetadata.workspace_gate_policy_applied && (
										<span className="text-blue-600 dark:text-blue-400 font-bold">workspace policy</span>
									)}
								</div>
								{snapshot.auditMetadata.gate_reason_codes &&
									snapshot.auditMetadata.gate_reason_codes.length > 0 && (
										<ul className="mt-1 list-disc list-inside text-[8.5px] text-red-500/90 space-y-0.5">
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
										{snapshot.auditMetadata.violations!.slice(0, 4).map((v) => (
											<li className="truncate font-mono" key={v}>
												{formatViolationLabel(v)}
											</li>
										))}
									</ul>
								)}
							</div>
						)
					})}
				</div>
			)}

			{selectedSnapshot && (
				<div className="mt-2 rounded-sm border border-description/20 p-1 animate-fadeIn" ref={detailPanelRef}>
					<AuditReportPanel auditMetadata={selectedSnapshot.auditMetadata} variant="neutral" />
				</div>
			)}
		</div>
	)
})

AuditHistoryStrip.displayName = "AuditHistoryStrip"
