import { type AuditGateConfig, auditGateConfigToOptions } from "@shared/audit/auditGateConfig"
import { evaluateCompletionGate } from "@shared/audit/auditGateReport"
import { AUDIT_TREND_LABELS, type AuditTrend } from "@shared/audit/auditMessages"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import { HARDENING_GRADE_STYLES, type HardeningGrade } from "@shared/audit/taskAuditUtils"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ShieldCheckIcon, ShieldOffIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

export type { AuditGateConfig }

interface TaskAuditBadgeProps {
	auditMetadata?: TaskAuditMetadata
	auditTrend?: AuditTrend
	auditHealth?: AuditHealthSummary
	gateConfig?: AuditGateConfig
	className?: string
}

const TREND_STYLES: Record<Exclude<AuditTrend, "unknown">, string> = {
	improved: "text-emerald-500",
	degraded: "text-red-500",
	stable: "text-description/60",
}

const GATE_READINESS_STYLES = {
	ready: "border-emerald-500/40",
	warning: "border-amber-500/40",
	blocked: "border-red-500/40",
} as const

export const TaskAuditBadge = memo(({ auditMetadata, auditTrend, auditHealth, gateConfig, className }: TaskAuditBadgeProps) => {
	if (!auditMetadata?.hardening_grade) {
		return null
	}

	const grade = auditMetadata.hardening_grade as HardeningGrade
	const divergent = auditMetadata.divergence_detected === true
	const trendLabel = auditTrend && auditTrend !== "unknown" ? AUDIT_TREND_LABELS[auditTrend] : undefined

	const gateDecision = useMemo(() => {
		if (!gateConfig?.gateEnabled) {
			return undefined
		}
		return evaluateCompletionGate(auditMetadata, auditGateConfigToOptions(gateConfig))
	}, [auditMetadata, gateConfig])

	const gateReadiness = gateDecision?.blocked ? "blocked" : gateDecision ? "ready" : undefined
	const GateIcon = gateReadiness === "blocked" ? ShieldOffIcon : gateReadiness === "ready" ? ShieldCheckIcon : ShieldCheckIcon

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border",
				HARDENING_GRADE_STYLES[grade],
				gateReadiness && GATE_READINESS_STYLES[gateReadiness],
				className,
			)}
			title={
				Number.isFinite(auditMetadata.hardening_score)
					? [
							`Hardening: ${auditMetadata.hardening_score}/100`,
							divergent ? "Divergent" : undefined,
							trendLabel,
							auditHealth ? `Avg ${auditHealth.averageScore} · ${auditHealth.snapshotCount} audits` : undefined,
							auditHealth && auditHealth.gateBlockCount > 0
								? `${auditHealth.gateBlockCount} gate block(s)`
								: undefined,
							gateDecision
								? gateDecision.blocked
									? `Gate blocked: ${gateDecision.reasons.map((r) => r.message).join("; ")}`
									: `Gate ready (threshold ${gateDecision.effectiveThreshold})`
								: undefined,
						]
							.filter(Boolean)
							.join(" · ")
					: undefined
			}>
			<GateIcon className="size-2.5" />
			{grade}
			{Number.isFinite(auditMetadata.hardening_score) && (
				<span className="font-mono opacity-80">{auditMetadata.hardening_score}</span>
			)}
			{auditTrend === "improved" && <TrendingUpIcon className={cn("size-2.5", TREND_STYLES.improved)} />}
			{auditTrend === "degraded" && <TrendingDownIcon className={cn("size-2.5", TREND_STYLES.degraded)} />}
		</span>
	)
})

TaskAuditBadge.displayName = "TaskAuditBadge"
