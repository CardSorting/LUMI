import { cn } from "@/lib/utils"

/** Notebook-like audit surfaces — informational whispers, not command-center alerts. */
export const auditLabel = "text-[9px] text-description/50 font-medium leading-relaxed"

export const auditBadge = cn(
	"px-1.5 py-0.5 rounded-full text-[8px] font-normal",
	"border border-description/10 bg-black/[0.02] dark:bg-white/[0.02] text-description/70",
)

export const auditStrip = cn("rounded-lg border border-description/10", "bg-black/[0.015] dark:bg-white/[0.015] overflow-hidden")

export const auditInset = "rounded-md bg-black/[0.02] dark:bg-white/[0.02] p-2.5"

/** Vertical reading surface — research notebook, not monitoring grid. */
export const auditReadingSurface = cn(
	"mt-2.5 animate-mira-reading-reveal rounded-lg p-4 space-y-5 opacity-[0.96]",
	"bg-gradient-to-b from-black/[0.025] via-black/[0.01] to-transparent",
	"dark:from-white/[0.025] dark:via-white/[0.01]",
)

export const auditReadingRow = "flex flex-wrap items-start gap-x-6 gap-y-4"

export const auditReadingGroup = "space-y-2"

export const auditSoftDivider = "pt-4 mt-1"

export const auditSideAccent = "border-l-2 border-amber-500/25 pl-3 py-2.5"

/** Older audit rows visually exhale into the background — memory settling. */
export function auditExhaleOpacity(indexFromLatest: number, isSelected = false): string {
	if (isSelected) return "opacity-100"
	if (indexFromLatest === 0) return "opacity-95"
	if (indexFromLatest === 1) return "opacity-82"
	if (indexFromLatest === 2) return "opacity-72"
	return "opacity-62"
}
