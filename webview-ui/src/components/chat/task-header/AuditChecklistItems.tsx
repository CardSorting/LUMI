import type { PreCompletionChecklistItem } from "@shared/audit/auditPreCompletionChecklist"
import { CheckIcon, CircleAlertIcon, CircleXIcon, InfoIcon } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"

const STATUS_STYLES = {
	pass: "text-emerald-600 dark:text-emerald-400",
	fail: "text-red-600 dark:text-red-400",
	warn: "text-amber-600 dark:text-amber-400",
	info: "text-description/70",
} as const

function ChecklistStatusIcon({ status }: { status: PreCompletionChecklistItem["status"] }) {
	switch (status) {
		case "pass":
			return <CheckIcon className="size-3 shrink-0" />
		case "fail":
			return <CircleXIcon className="size-3 shrink-0" />
		case "warn":
			return <CircleAlertIcon className="size-3 shrink-0" />
		default:
			return <InfoIcon className="size-3 shrink-0" />
	}
}

interface AuditChecklistItemsProps {
	items: PreCompletionChecklistItem[]
	/** When set, only show items matching these statuses (GitHub Checks failed-only view). */
	filterStatuses?: PreCompletionChecklistItem["status"][]
	className?: string
}

export const AuditChecklistItems = memo(({ items, filterStatuses, className }: AuditChecklistItemsProps) => {
	const visibleItems = filterStatuses ? items.filter((item) => filterStatuses.includes(item.status)) : items
	if (visibleItems.length === 0) {
		return null
	}

	return (
		<ul className={cn("space-y-1.5 list-none pl-0", className)}>
			{visibleItems.map((item) => (
				<li className="flex items-start gap-2" key={item.key}>
					<span className={cn("mt-0.5", STATUS_STYLES[item.status])}>
						<ChecklistStatusIcon status={item.status} />
					</span>
					<div className="min-w-0 flex-1">
						<span className={cn("font-medium text-[9px]", STATUS_STYLES[item.status])}>{item.label}</span>
						{item.detail && <span className="block text-[8.5px] text-description/70 break-words">{item.detail}</span>}
					</div>
				</li>
			))}
		</ul>
	)
})

AuditChecklistItems.displayName = "AuditChecklistItems"
