import { memo, useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"

export const TASK_AUDIT_QUALITY_GATE_ID = "task-audit-quality-gate"

interface AuditHeaderJumpLinkProps {
	className?: string
	label?: string
	/** When set, scrolls to this element after expanding the task header. */
	scrollTargetId?: string
}

/** Expands task header audit panels — bridges chat annotations to header quality gate UI. */
export const AuditHeaderJumpLink = memo(
	({ className, label = "View in task header", scrollTargetId = TASK_AUDIT_QUALITY_GATE_ID }: AuditHeaderJumpLinkProps) => {
		const { setExpandTaskHeader } = useExtensionState()

		const handleClick = useCallback(
			(event: React.MouseEvent) => {
				event.stopPropagation()
				setExpandTaskHeader(true)
				if (scrollTargetId) {
					window.requestAnimationFrame(() => {
						document.getElementById(scrollTargetId)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
					})
				}
			},
			[scrollTargetId, setExpandTaskHeader],
		)

		return (
			<button
				className={cn(
					"text-[8px] uppercase tracking-wider font-bold text-description/70 hover:text-foreground cursor-pointer bg-transparent border-0 p-0",
					className,
				)}
				onClick={handleClick}
				type="button">
				{label}
			</button>
		)
	},
)

AuditHeaderJumpLink.displayName = "AuditHeaderJumpLink"
