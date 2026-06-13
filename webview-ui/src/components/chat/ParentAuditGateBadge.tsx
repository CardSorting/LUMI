import { describeGateReadiness } from "@shared/audit/auditGateReadiness"
import { getLatestAuditFromMessages } from "@shared/audit/auditMessages"
import { ShieldAlertIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"

const LEVEL_STYLES = {
	ready: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
	warning: "text-amber-600 dark:text-amber-400 border-amber-500/30",
	blocked: "text-red-600 dark:text-red-400 border-red-500/30",
	disabled: "text-description/60 border-description/30",
} as const

export const ParentAuditGateBadge = memo(() => {
	const { dietcodeMessages } = useExtensionState()
	const metadata = useMemo(() => getLatestAuditFromMessages(dietcodeMessages), [dietcodeMessages])
	const gateOptions = useAuditGateEvaluation(metadata)

	const readiness = useMemo(() => describeGateReadiness(metadata, gateOptions), [metadata, gateOptions])

	if (readiness.level === "disabled") {
		return null
	}

	const Icon = readiness.level === "blocked" ? ShieldOffIcon : readiness.level === "ready" ? ShieldCheckIcon : ShieldAlertIcon

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border",
				LEVEL_STYLES[readiness.level],
			)}
			title={readiness.tooltip}>
			<Icon className="size-2.5" />
			Parent gate: {readiness.shortLabel}
		</span>
	)
})

ParentAuditGateBadge.displayName = "ParentAuditGateBadge"
