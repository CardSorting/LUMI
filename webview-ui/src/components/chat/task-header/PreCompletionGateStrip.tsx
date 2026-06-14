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
import { auditStrip } from "../audit/auditUiStyles"
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
				aria-label="Before we wrap up"
				className={cn(
					"mt-2 px-3 py-2.5 text-[10px] lumi-audit-exhale transition-opacity duration-[2s]",
					auditStrip,
					className,
				)}
				id={TASK_AUDIT_QUALITY_GATE_ID}>
				<button
					aria-expanded={expanded}
					className="flex w-full items-center justify-between cursor-pointer bg-transparent border-0 p-0 text-left font-sans"
					onClick={() => setExpanded(!expanded)}
					type="button">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-medium text-description/85">Before we wrap up</span>
						<span
							className={cn(
								"px-1.5 py-0.5 rounded-full text-[8px] font-medium border",
								checklist.blocked
									? "border-amber-500/40 text-amber-700 dark:text-amber-400"
									: warnCount > 0
										? "border-amber-500/40 text-amber-600 dark:text-amber-400"
										: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
							)}>
							{checklist.blocked ? "Worth revisiting" : warnCount > 0 ? "Almost there" : "Looking good"}
						</span>
						<span className="font-mono text-description/70">
							{checklist.score}/{checklist.effectiveThreshold}
						</span>
						{failCount > 0 && <span className="text-amber-600 dark:text-amber-400">{failCount} to revisit</span>}
						{warnCount > 0 && <span className="text-amber-600 dark:text-amber-400">{warnCount} to review</span>}
						{pendingAdvisoryCount > 0 && !checklist.blocked && (
							<span className="text-amber-600/90">
								{pendingAdvisoryCount} note{pendingAdvisoryCount === 1 ? "" : "s"}
							</span>
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
						className="mt-2 text-[9px] font-medium text-amber-700/80 dark:text-amber-400/80 hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer bg-transparent border-0 p-0"
						onClick={onScrollToLatestGateBlock}
						type="button">
						Jump to latest note
					</button>
				)}

				{pendingAdvisoryCount > 0 && onScrollToLatestAdvisory && (
					<button
						className="mt-2 text-[9px] font-medium text-amber-700/80 dark:text-amber-400/80 hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer bg-transparent border-0 p-0"
						onClick={onScrollToLatestAdvisory}
						type="button">
						Jump to latest note
					</button>
				)}
			</section>
		)
	},
)

PreCompletionGateStrip.displayName = "PreCompletionGateStrip"
