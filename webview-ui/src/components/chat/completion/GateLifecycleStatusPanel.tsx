import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import { getGateLifecycleHeadline, getGateLifecycleHeadlineTone } from "@shared/completion/gateLifecycleLabels"
import type { GateLifecycleFreshness } from "@shared/completion/gateLifecycleMessages"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

interface GateLifecycleStatusPanelProps {
	decision?: GateLifecycleDecision
	freshness?: GateLifecycleFreshness
	continuityMarker?: string
	className?: string
}

const AXIS_LABELS = {
	engineering: "Engineering",
	verification: "Verification",
	documentation: "Documentation",
	ledger: "Ledger",
	finalization: "Finalization",
} as const

const HEADLINE_TONE_CLASS = {
	neutral: "border-blue-500/30 text-blue-700 dark:text-blue-300 bg-blue-500/5",
	success: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5",
	warning: "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/5",
	danger: "border-red-500/30 text-red-700 dark:text-red-300 bg-red-500/5",
} as const

const FRESHNESS_LABEL: Record<GateLifecycleFreshness, string> = {
	current: "Live",
	stale: "Stale snapshot",
	unknown: "Authority unclear",
}

function axisTone(status: string): string {
	switch (status) {
		case "passed":
			return "text-emerald-600 dark:text-emerald-400"
		case "failed":
			return "text-red-600 dark:text-red-400"
		case "running":
			return "text-blue-600 dark:text-blue-400"
		case "pending":
			return "text-amber-600 dark:text-amber-400"
		default:
			return "text-description/70"
	}
}

function formatEvaluatedAt(evaluatedAt: number): string {
	const ageMs = Date.now() - evaluatedAt
	if (ageMs < 60_000) {
		return "Updated just now"
	}
	const minutes = Math.floor(ageMs / 60_000)
	if (minutes < 60) {
		return `Updated ${minutes}m ago`
	}
	return `Updated ${new Date(evaluatedAt).toLocaleTimeString()}`
}

function stateSubBanner(decision: GateLifecycleDecision): string | null {
	const retryLocked = decision.lifecycleState === "completion_retry_locked"
	const verified = decision.engineering === "passed"

	if (decision.lifecycleState === "audit_gate_corrupt") {
		return decision.reasonCode === "finalization.access_denied"
			? "Access denied — finalization blocked by policy"
			: "Gate corrupt — fail-closed stop"
	}

	if (retryLocked && verified) {
		return "Completion retry-locked — finalization lane active"
	}

	if (decision.lifecycleState === "completed_without_retry_completion") {
		return "Receipt sealed — session complete"
	}

	if (decision.lifecycleState === "receipt_sealed") {
		return "Finalization complete — seal receipt to end session"
	}

	if (decision.lifecycleState === "finalization_running") {
		return "Finalization running — docs and ledger updating"
	}

	if (decision.lifecycleState === "finalization_completed") {
		return "Finalization completed — ready to seal"
	}

	if (decision.lifecycleState === "finalization_ready" || decision.lifecycleState === "engineering_verified") {
		return "Finalization lane active"
	}

	return null
}

export const GateLifecycleStatusPanel = memo(
	({ decision, freshness = "current", continuityMarker, className }: GateLifecycleStatusPanelProps) => {
		if (!decision) {
			return null
		}

		const headline = getGateLifecycleHeadline(decision.lifecycleState)
		const headlineTone = getGateLifecycleHeadlineTone(decision.lifecycleState)
		const subBanner = stateSubBanner(decision)
		const evaluatedLabel = useMemo(() => formatEvaluatedAt(decision.evaluatedAt), [decision.evaluatedAt])
		const isStale = freshness === "stale" || freshness === "unknown"

		const evidencePreview = decision.finalizationEvidence?.changelogEntryPreview
		const receiptId = decision.completionReceipt?.receiptId

		return (
			<section
				aria-label="Gate lifecycle status"
				className={cn(
					"rounded-md border px-3 py-2.5 space-y-2",
					isStale ? "border-amber-500/30 bg-amber-500/5" : "border-description/15",
					className,
				)}>
				<div className="flex items-center justify-between gap-2">
					<span
						className={cn(
							"inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
							HEADLINE_TONE_CLASS[headlineTone],
						)}>
						{headline}
					</span>
					<div className="flex flex-col items-end gap-0.5 shrink-0">
						<span
							className={cn(
								"text-[8px] font-medium",
								freshness === "current" ? "text-description/60" : "text-amber-700 dark:text-amber-300",
							)}>
							{FRESHNESS_LABEL[freshness]}
						</span>
						<span className="text-[8px] text-description/60">{evaluatedLabel}</span>
					</div>
				</div>

				{isStale ? (
					<p className="m-0 text-[9px] text-amber-700 dark:text-amber-300">
						This gate snapshot may be outdated. Await a fresh lifecycle publish before acting.
					</p>
				) : null}

				<p className="m-0 text-[11px] font-medium text-description">{decision.operatorMessage}</p>

				{subBanner ? <p className="m-0 text-[10px] text-amber-700 dark:text-amber-300">{subBanner}</p> : null}

				<div className="grid grid-cols-2 gap-1.5">
					{(Object.keys(AXIS_LABELS) as Array<keyof typeof AXIS_LABELS>).map((key) => (
						<div className="flex items-center justify-between text-[9px]" key={key}>
							<span className="text-description/80">{AXIS_LABELS[key]}</span>
							<span className={cn("font-medium capitalize", axisTone(decision[key]))}>{decision[key]}</span>
						</div>
					))}
				</div>

				{decision.allowedActions.length > 0 ? (
					<div className="text-[9px] text-description/80">
						<span className="font-medium">Next: </span>
						{decision.allowedActions.join(", ")}
					</div>
				) : null}

				{decision.forbiddenActions.length > 0 ? (
					<div className="text-[9px] text-description/70">
						<span className="font-medium">Avoid: </span>
						{decision.forbiddenActions.join(", ")}
					</div>
				) : null}

				{(continuityMarker || evidencePreview || receiptId) && (
					<details className="text-[9px] text-description/70">
						<summary className="cursor-pointer font-medium">Evidence</summary>
						{continuityMarker ? <p className="m-0 mt-1 font-mono">Continuity: {continuityMarker}</p> : null}
						{receiptId ? <p className="m-0 mt-1 font-mono">Receipt: {receiptId}</p> : null}
						{evidencePreview ? <p className="m-0 mt-1 whitespace-pre-wrap">{evidencePreview}</p> : null}
					</details>
				)}
			</section>
		)
	},
)

GateLifecycleStatusPanel.displayName = "GateLifecycleStatusPanel"
