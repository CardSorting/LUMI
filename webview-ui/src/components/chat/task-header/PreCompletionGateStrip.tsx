import {
	buildPreCompletionChecklistSummary,
	type PreCompletionChecklistSummary,
	shouldShowPreCompletionChecklist,
} from "@shared/audit/auditPreCompletionChecklist"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"
import { AuditChecklistItems } from "./AuditChecklistItems"
import { TASK_AUDIT_QUALITY_GATE_ID } from "./AuditHeaderJumpLink"

interface PreCompletionGateStripProps {
	auditMetadata?: TaskAuditMetadata
	onScrollToLatestGateBlock?: () => void
	onScrollToLatestAdvisory?: () => void
	className?: string
}

export const PreCompletionGateStrip = memo(
	({ auditMetadata, onScrollToLatestGateBlock, onScrollToLatestAdvisory, className }: PreCompletionGateStripProps) => {
		const [expanded, setExpanded] = useState(false)
		const previousBlockedRef = useRef(false)
		const gateOptions = useAuditGateEvaluation(auditMetadata)
		const summary = useMemo(
			() => buildPreCompletionChecklistSummary(auditMetadata, gateOptions),
			[auditMetadata, gateOptions],
		)

		const blocked = summary && "blocked" in summary ? summary.blocked : false

		useEffect(() => {
			if (blocked && !previousBlockedRef.current) {
				setExpanded(true)
			}
			previousBlockedRef.current = blocked
		}, [blocked])

		if (!shouldShowPreCompletionChecklist(summary)) {
			return null
		}

		const checklist = summary as PreCompletionChecklistSummary
		const failCount = checklist.items.filter((item) => item.status === "fail").length
		const warnCount = checklist.items.filter((item) => item.status === "warn").length
		const pendingAdvisoryCount = gateOptions.advisoryMetadata?.violations?.length ?? 0

		return (
			<section
				aria-label="Pre-completion quality gate"
				className={cn(
					"mt-2 rounded-xs border px-2.5 py-2 text-[9px]",
					checklist.blocked
						? "border-red-500/25 bg-red-500/5"
						: warnCount > 0
							? "border-amber-500/25 bg-amber-500/5"
							: "border-emerald-500/20 bg-emerald-500/5",
					className,
				)}
				id={TASK_AUDIT_QUALITY_GATE_ID}>
				<button
					aria-expanded={expanded}
					className="flex w-full items-center justify-between cursor-pointer bg-transparent border-0 p-0 text-left font-sans"
					onClick={() => setExpanded(!expanded)}
					type="button">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-bold uppercase tracking-wider text-description/80">Quality Gate</span>
						<span
							className={cn(
								"px-1.5 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-wider border",
								checklist.blocked
									? "border-red-500/40 text-red-600 dark:text-red-400"
									: warnCount > 0
										? "border-amber-500/40 text-amber-600 dark:text-amber-400"
										: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
							)}>
							{checklist.blocked ? "Blocked" : warnCount > 0 ? "Marginal" : "Ready"}
						</span>
						<span className="font-mono text-description/70">
							{checklist.score}/{checklist.effectiveThreshold}
						</span>
						{failCount > 0 && <span className="text-red-500 font-bold">{failCount} failed</span>}
						{warnCount > 0 && <span className="text-amber-500 font-bold">{warnCount} warning</span>}
						{pendingAdvisoryCount > 0 && !checklist.blocked && (
							<span className="text-amber-500/90 font-bold">{pendingAdvisoryCount} advisory</span>
						)}
					</div>
					{expanded ? (
						<ChevronDownIcon className="size-3 text-description/60" />
					) : (
						<ChevronRightIcon className="size-3 text-description/60" />
					)}
				</button>

				{expanded && <AuditChecklistItems className="mt-2" items={checklist.items} />}

				{checklist.blocked && onScrollToLatestGateBlock && (
					<button
						className="mt-2 text-[8px] uppercase tracking-wider font-bold text-red-600/80 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-400 cursor-pointer bg-transparent border-0 p-0"
						onClick={onScrollToLatestGateBlock}
						type="button">
						Jump to latest gate block
					</button>
				)}

				{pendingAdvisoryCount > 0 && onScrollToLatestAdvisory && (
					<button
						className="mt-2 text-[8px] uppercase tracking-wider font-bold text-amber-600/80 dark:text-amber-400/80 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer bg-transparent border-0 p-0"
						onClick={onScrollToLatestAdvisory}
						type="button">
						Jump to latest advisory
					</button>
				)}
			</section>
		)
	},
)

PreCompletionGateStrip.displayName = "PreCompletionGateStrip"
