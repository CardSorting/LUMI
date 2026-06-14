import type { AuditMessageSnapshot } from "@shared/audit/auditMessages"
import {
	buildViolationSessionLedger,
	countOpenViolationLedgerEntries,
	shouldAutoExpandViolationLedger,
	type ViolationLedgerEntry,
} from "@shared/audit/auditSessionLedger"
import { getViolationRemediation } from "@shared/audit/auditViolationRemediation"
import { formatViolationLabel } from "@shared/audit/taskAuditUtils"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { auditStrip } from "../audit/auditUiStyles"

interface ViolationSessionLedgerStripProps {
	snapshots: AuditMessageSnapshot[]
	onScrollToAuditMessage?: (ts: number) => void
	className?: string
}

function LedgerEntryRow({ entry, onSelect }: { entry: ViolationLedgerEntry; onSelect?: (entry: ViolationLedgerEntry) => void }) {
	const hint = getViolationRemediation(entry.violation)
	const isClickable = onSelect !== undefined

	const content = (
		<>
			<span
				className={cn(
					"break-words",
					entry.status === "open" ? "text-amber-600 dark:text-amber-400" : "text-description/60 line-through",
				)}>
				{formatViolationLabel(entry.violation)}
			</span>
			{hint && entry.status === "open" && (
				<span className="block text-[8px] text-description/65 font-sans font-normal">{hint}</span>
			)}
		</>
	)

	if (isClickable) {
		return (
			<li className="flex items-start justify-between gap-2">
				<button
					className="min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer font-sans"
					onClick={() => onSelect(entry)}
					title={hint}
					type="button">
					{content}
				</button>
				<span className="shrink-0 font-mono text-[8px] text-description/60">×{entry.snapshotCount}</span>
			</li>
		)
	}

	return (
		<li className="flex items-start justify-between gap-2">
			<div className="min-w-0 flex-1">{content}</div>
			<span className="shrink-0 font-mono text-[8px] text-description/60">×{entry.snapshotCount}</span>
		</li>
	)
}

/** SonarQube-style session issue ledger — open vs resolved violations across the task. */
export const ViolationSessionLedgerStrip = memo(
	({ snapshots, onScrollToAuditMessage, className }: ViolationSessionLedgerStripProps) => {
		const [expanded, setExpanded] = useState(false)
		const previousOpenCountRef = useRef(0)
		const ledger = useMemo(() => buildViolationSessionLedger(snapshots), [snapshots])
		const openCount = useMemo(() => countOpenViolationLedgerEntries(ledger), [ledger])
		const resolvedCount = ledger.length - openCount

		useEffect(() => {
			if (shouldAutoExpandViolationLedger(snapshots, previousOpenCountRef.current)) {
				setExpanded(true)
			}
			previousOpenCountRef.current = openCount
		}, [snapshots, openCount])

		const handleSelectEntry = useCallback(
			(entry: ViolationLedgerEntry) => {
				onScrollToAuditMessage?.(entry.firstSeenTs)
			},
			[onScrollToAuditMessage],
		)

		if (ledger.length === 0) {
			return null
		}

		return (
			<section
				aria-label="Open notes"
				className={cn(
					"mt-2 px-2.5 py-2 text-[9px] lumi-audit-exhale transition-opacity duration-[2s]",
					auditStrip,
					className,
				)}>
				<button
					aria-expanded={expanded}
					className="flex w-full items-center justify-between cursor-pointer bg-transparent border-0 p-0 text-left font-sans"
					onClick={() => setExpanded(!expanded)}
					type="button">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-medium text-description/85">Open notes</span>
						{openCount > 0 && (
							<span className="text-amber-600/80 dark:text-amber-400/80 font-normal">{openCount} open</span>
						)}
						{resolvedCount > 0 && <span className="text-description/55 font-normal">{resolvedCount} settled</span>}
					</div>
					{expanded ? (
						<ChevronDownIcon className="size-3 text-description/60" />
					) : (
						<ChevronRightIcon className="size-3 text-description/60" />
					)}
				</button>

				{expanded && (
					<div className="mt-2 space-y-2">
						{openCount > 0 && (
							<ul className="list-none space-y-1 pl-0">
								{ledger
									.filter((entry) => entry.status === "open")
									.slice(0, 6)
									.map((entry) => (
										<LedgerEntryRow entry={entry} key={entry.violation} onSelect={handleSelectEntry} />
									))}
							</ul>
						)}
						{resolvedCount > 0 && (
							<ul className="list-none space-y-1 pl-0 border-t border-description/10 pt-2">
								{ledger
									.filter((entry) => entry.status === "resolved")
									.slice(0, 4)
									.map((entry) => (
										<LedgerEntryRow entry={entry} key={entry.violation} />
									))}
							</ul>
						)}
					</div>
				)}
			</section>
		)
	},
)

ViolationSessionLedgerStrip.displayName = "ViolationSessionLedgerStrip"
