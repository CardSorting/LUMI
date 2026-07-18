import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import { sanitizeWebviewMessageContent } from "@shared/diagnostics/webviewDiagnostics"
import { memo } from "react"
import { cn } from "@/lib/utils"

interface CompletionFunnelStatusPanelProps {
	event?: CompletionFunnelEvent
	terminalCompletion?: boolean
	showInternalDiagnostics?: boolean
	className?: string
}

const PHASE_LABEL = {
	evaluating: "Evaluating",
	ready: "Ready to complete",
	blocked: "Workspace changes required",
	completed: "Completed",
	failed: "Blocked",
} as const

const PHASE_CLASS = {
	evaluating: "border-blue-500/30 text-blue-700 dark:text-blue-300 bg-blue-500/5",
	ready: "border-blue-500/30 text-blue-700 dark:text-blue-300 bg-blue-500/5",
	blocked: "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/5",
	completed: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5",
	failed: "border-red-500/30 text-red-700 dark:text-red-300 bg-red-500/5",
} as const

export const CompletionFunnelStatusPanel = memo(
	({ event, terminalCompletion = false, showInternalDiagnostics = false, className }: CompletionFunnelStatusPanelProps) => {
		if (!event && !terminalCompletion) return null
		const terminal = terminalCompletion || event?.terminal === true
		const phase = terminal ? "completed" : (event?.phase ?? "evaluating")
		const instruction = sanitizeWebviewMessageContent(
			terminal ? "Task completion is recorded. No completion action remains." : (event?.canonicalInstruction ?? ""),
		)
		const nextAction = event && !terminal && event.nextAllowedAction !== "none" ? event.nextAllowedAction : undefined

		return (
			<section aria-label="Completion funnel status" className={cn("rounded-md border px-3 py-2.5 space-y-2", className)}>
				<div className="flex items-center justify-between gap-2">
					<span
						className={cn(
							"inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
							PHASE_CLASS[phase],
						)}>
						{PHASE_LABEL[phase]}
					</span>
					<span className="text-[8px] font-medium text-description/60">Central completion funnel</span>
				</div>

				<p className="m-0 text-[11px] font-medium text-description">{instruction}</p>

				{nextAction ? (
					<div className="text-[9px] text-description/80">
						<span className="font-medium">Next: </span>
						{sanitizeWebviewMessageContent(nextAction)}
					</div>
				) : null}

				{showInternalDiagnostics && event ? (
					<details className="text-[9px] text-description/70">
						<summary className="cursor-pointer font-medium">Funnel audit trace</summary>
						{event.decisionId ? <p className="m-0 mt-1 font-mono">Decision: {event.decisionId}</p> : null}
						<p className="m-0 mt-1 font-mono">Revision: {event.graphRevision}</p>
						<ol className="m-0 mt-1 pl-4">
							{event.stages.map((stage, index) => (
								<li key={`${stage.stage}-${index}`}>
									{stage.stage}: {stage.result} — {sanitizeWebviewMessageContent(stage.reason)}
								</li>
							))}
						</ol>
					</details>
				) : null}
			</section>
		)
	},
)

CompletionFunnelStatusPanel.displayName = "CompletionFunnelStatusPanel"
