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
					"inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border cursor-pointer bg-transparent font-sans hover:opacity-90",
					isBlocked
						? "border-red-500/40 text-red-600 dark:text-red-400"
						: "border-amber-500/40 text-amber-600 dark:text-amber-400",
					className,
				)}
				onClick={(event) => {
					event.stopPropagation()
					onExpandTaskHeader()
				}}
				title={`Audit health: ${label}. Click to open audit panel.`}
				type="button">
				{label}
			</button>
		)
	}

	return (
		<span
			className={cn(
				"inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border",
				isBlocked
					? "border-red-500/40 text-red-600 dark:text-red-400"
					: "border-amber-500/40 text-amber-600 dark:text-amber-400",
				className,
			)}
			title={label}>
			{label}
		</span>
	)
})

AuditHealthChip.displayName = "AuditHealthChip"
