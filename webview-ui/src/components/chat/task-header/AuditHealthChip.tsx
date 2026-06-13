import { buildAuditHealthChipLabel } from "@shared/audit/auditHealthDigest"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import { memo } from "react"
import { cn } from "@/lib/utils"

interface AuditHealthChipProps {
	auditHealth?: AuditHealthSummary
	onExpandTaskHeader?: () => void
	className?: string
}

/** Collapsed-header audit health chip — surfaces gate blocks and advisories at a glance. */
export const AuditHealthChip = memo(({ auditHealth, onExpandTaskHeader, className }: AuditHealthChipProps) => {
	const label = buildAuditHealthChipLabel(auditHealth)
	if (!label) {
		return null
	}

	const isBlocked = (auditHealth?.trailingGateBlockStreak ?? 0) > 0 || (auditHealth?.gateBlockCount ?? 0) > 0

	if (onExpandTaskHeader) {
		return (
			<button
				className={cn(
					"inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-normal border cursor-pointer bg-transparent font-sans hover:opacity-80 transition-opacity",
					isBlocked
						? "border-amber-500/25 text-amber-700/80 dark:text-amber-400/80"
						: "border-description/15 text-description/70",
					className,
				)}
				onClick={(event) => {
					event.stopPropagation()
					onExpandTaskHeader()
				}}
				title={`Check-in: ${label}. Click for details.`}
				type="button">
				{label}
			</button>
		)
	}

	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-normal border",
				isBlocked
					? "border-amber-500/25 text-amber-700/80 dark:text-amber-400/80"
					: "border-description/15 text-description/70",
				className,
			)}
			title={label}>
			{label}
		</span>
	)
})

AuditHealthChip.displayName = "AuditHealthChip"
