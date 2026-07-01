import type { CanonicalLifecycleDecision } from "@shared/completion/canonicalLifecycleDecision"
import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import {
	getCanonicalPhaseHeadline,
	getCanonicalPhaseSubtitle,
	getCanonicalPhaseTone,
} from "@shared/completion/gateLifecycleLabels"
import type { GateLifecycleFreshness } from "@shared/completion/gateLifecycleMessages"
import { type LifecycleProjection, resolveLifecycleProjection } from "@shared/completion/lifecycleProjection"
import { sanitizeWebviewMessageContent } from "@shared/diagnostics/webviewDiagnostics"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

interface GateLifecycleStatusPanelProps {
	/** Canonical decision from the CompletionLifecycleDecisionEngine, if available. */
	canonicalDecision?: CanonicalLifecycleDecision
	/** Legacy gate lifecycle decision from message history, if available. */
	decision?: GateLifecycleDecision
	freshness?: GateLifecycleFreshness
	continuityMarker?: string
	/** Whether task progress / checklist is complete (all steps done). */
	checklistComplete?: boolean
	showInternalDiagnostics?: boolean
	className?: string
}

const HEADLINE_TONE_CLASS = {
	neutral: "border-blue-500/30 text-blue-700 dark:text-blue-300 bg-blue-500/5",
	success: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5",
	warning: "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/5",
	danger: "border-red-500/30 text-red-700 dark:text-red-300 bg-red-500/5",
} as const

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

export const GateLifecycleStatusPanel = memo(
	({
		canonicalDecision,
		decision,
		freshness = "current",
		continuityMarker,
		checklistComplete = false,
		showInternalDiagnostics = false,
		className,
	}: GateLifecycleStatusPanelProps) => {
		const projection: LifecycleProjection = useMemo(
			() =>
				resolveLifecycleProjection({
					canonicalDecision,
					legacyDecision: decision,
					freshness,
					continuityMarker,
					checklistComplete,
				}),
			[canonicalDecision, decision, freshness, continuityMarker, checklistComplete],
		)

		const evaluatedAt = decision?.evaluatedAt ?? Date.now()
		const evaluatedLabel = useMemo(() => formatEvaluatedAt(evaluatedAt), [evaluatedAt])

		if ((!decision && !canonicalDecision) || (!canonicalDecision && showInternalDiagnostics !== true)) {
			return null
		}

		const headline = getCanonicalPhaseHeadline(projection.phase)
		const subtitle = getCanonicalPhaseSubtitle(projection.phase)
		const headlineTone = getCanonicalPhaseTone(projection.phase)

		// Stale warning only renders when legacy is actionable — if legacy
		// is evidence-only (canonical exists, checklist complete, or stale),
		// the stale banner is suppressed to avoid confusion.
		const isStale = (projection.freshness === "stale" || projection.freshness === "unknown") && projection.isLegacyActionable

		const instruction = sanitizeWebviewMessageContent(projection.instruction)
		const nextAction = projection.nextAction ? sanitizeWebviewMessageContent(projection.nextAction) : null
		const forbiddenActions = projection.forbiddenActions
			.map((action) => sanitizeWebviewMessageContent(action))
			.filter(Boolean)
		const evidencePreview = decision?.finalizationEvidence?.changelogEntryPreview
		const receiptId = decision?.completionReceipt?.receiptId

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
						{projection.statusLabel}
					</span>
					<div className="flex flex-col items-end gap-0.5 shrink-0">
						<span
							className={cn(
								"text-[8px] font-medium",
								projection.freshness === "current" ? "text-description/60" : "text-amber-700 dark:text-amber-300",
							)}>
							{headline}
						</span>
						<span className="text-[8px] text-description/60">{evaluatedLabel}</span>
					</div>
				</div>

				{isStale ? (
					<p className="m-0 text-[9px] text-amber-700 dark:text-amber-300">
						This gate snapshot may be outdated. Await a fresh lifecycle publish before acting.
					</p>
				) : null}

				<p className="m-0 text-[11px] font-medium text-description">{instruction}</p>

				<p className="m-0 text-[10px] text-description/70">{subtitle}</p>

				{nextAction ? (
					<div className="text-[9px] text-description/80">
						<span className="font-medium">Next: </span>
						{nextAction}
					</div>
				) : null}

				{forbiddenActions.length > 0 ? (
					<div className="text-[9px] text-description/70">
						<span className="font-medium">Avoid: </span>
						{forbiddenActions.join(", ")}
					</div>
				) : null}

				{showInternalDiagnostics === true && (continuityMarker || evidencePreview || receiptId) && (
					<details className="text-[9px] text-description/70">
						<summary className="cursor-pointer font-medium">Internal diagnostics</summary>
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
