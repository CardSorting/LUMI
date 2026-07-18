import { shouldShowAuditHistoryStrip } from "@shared/audit/auditHistoryUtils"
import type { AuditMessageSnapshot, AuditTrend } from "@shared/audit/auditMessages"
import { buildOrchestratorGateStatus } from "@shared/audit/auditOrchestratorDigest"
import type { PreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { buildPreCompletionChecklistSummary, shouldShowPreCompletionChecklist } from "@shared/audit/auditPreCompletionChecklist"
import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { SubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import type { ResolvedCompletionFunnelSnapshot } from "@shared/completion/completionFunnelMessages"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ChevronRight } from "lucide-react"
import { memo, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"
import { CompletionFunnelStatusPanel } from "../completion/CompletionFunnelStatusPanel"
import { AuditHistoryStrip } from "./AuditHistoryStrip"
import { OrchestratorGateStrip } from "./OrchestratorGateStrip"
import { PreCompletionGateStrip } from "./PreCompletionGateStrip"
import { SubagentHandoffStrip } from "./SubagentHandoffStrip"
import { ViolationSessionLedgerStrip } from "./ViolationSessionLedgerStrip"

interface TaskNotesSectionProps {
	auditSnapshots?: AuditMessageSnapshot[]
	auditHealth?: AuditHealthSummary
	auditTrend?: AuditTrend
	checklistSummary?: PreCompletionChecklistSummary
	latestAuditMetadata?: TaskAuditMetadata
	completionFunnelSnapshot?: ResolvedCompletionFunnelSnapshot
	subagentAuditSummary?: SubagentAuditSummary
	onScrollToAuditMessage?: (ts: number) => void
	onScrollToLatestGateBlock?: () => void
	onScrollToLatestAdvisory?: () => void
}

/**
 * Single collapsible panel for audit / review content in the expanded task header.
 * Keeps the narrow details pane scannable — one row instead of many strips.
 */
export const TaskNotesSection = memo(
	({
		auditSnapshots,
		auditHealth,
		checklistSummary,
		latestAuditMetadata,
		completionFunnelSnapshot,
		subagentAuditSummary,
		onScrollToAuditMessage,
		onScrollToLatestGateBlock,
		onScrollToLatestAdvisory,
	}: TaskNotesSectionProps) => {
		const { showInternalDiagnostics } = useExtensionState()
		const gateOptions = useAuditGateEvaluation(latestAuditMetadata)
		const preCompletionSummary = useMemo(
			() => buildPreCompletionChecklistSummary(latestAuditMetadata, gateOptions),
			[latestAuditMetadata, gateOptions],
		)
		const orchestratorStatus = useMemo(
			() => buildOrchestratorGateStatus(latestAuditMetadata, gateOptions),
			[latestAuditMetadata, gateOptions],
		)

		const hasGateBlock = showInternalDiagnostics === true && latestAuditMetadata?.gate_blocked === true
		const showAuditHistory =
			showInternalDiagnostics === true &&
			Boolean(auditSnapshots && shouldShowAuditHistoryStrip(auditSnapshots, auditHealth))
		const showPreCompletion = showInternalDiagnostics === true && shouldShowPreCompletionChecklist(preCompletionSummary)
		const showOrchestrator =
			showInternalDiagnostics === true &&
			Boolean(orchestratorStatus && latestAuditMetadata && gateOptions.gateEnabled !== false) &&
			Boolean(
				orchestratorStatus &&
					(!orchestratorStatus.ready ||
						orchestratorStatus.artifactSarifPath ||
						orchestratorStatus.artifactReportPath ||
						orchestratorStatus.artifactManifestPath ||
						orchestratorStatus.criticalViolationCount > 0),
			)
		const showViolations = showInternalDiagnostics === true && Boolean(auditSnapshots && auditSnapshots.length > 0)
		const showSubagent =
			showInternalDiagnostics === true && Boolean(subagentAuditSummary && subagentAuditSummary.parentGateSignals.length > 0)
		const showCompletionFunnel = Boolean(completionFunnelSnapshot?.terminalCompletion || completionFunnelSnapshot?.event)

		const hasContent =
			showCompletionFunnel || showAuditHistory || showPreCompletion || showOrchestrator || showViolations || showSubagent

		const summaryLabel = useMemo(() => {
			if (showInternalDiagnostics === true) return "Internal diagnostics"
			if (hasGateBlock) return "Needs your review"
			if ((auditHealth?.warningViolationCount ?? 0) + (auditHealth?.criticalViolationCount ?? 0) > 0) {
				return "Notes to review"
			}
			return "Notes & status"
		}, [auditHealth?.criticalViolationCount, auditHealth?.warningViolationCount, hasGateBlock, showInternalDiagnostics])

		const [open, setOpen] = useState(hasGateBlock)

		useEffect(() => {
			if (hasGateBlock) {
				setOpen(true)
			}
		}, [hasGateBlock])

		if (!hasContent) {
			return null
		}

		return (
			<details
				className="lumi-inline-disclosure mt-1 rounded-sm border border-border/25 bg-accent/5 group"
				onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
				open={open}>
				<summary
					className={cn(
						"lumi-details-trigger flex items-center gap-2 px-2 py-1.5 cursor-pointer list-none text-[11px]",
						hasGateBlock && "text-amber-700 dark:text-amber-400",
					)}>
					<ChevronRight
						aria-hidden
						className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
					/>
					<span className="font-medium flex-1 min-w-0 truncate">{summaryLabel}</span>
					{hasGateBlock ? (
						<span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium border border-amber-500/40 text-amber-700 dark:text-amber-400">
							Review
						</span>
					) : null}
				</summary>

				<div className="flex flex-col gap-1 px-1 pb-1.5 min-h-0 divide-y divide-border/15">
					{showCompletionFunnel && completionFunnelSnapshot ? (
						<CompletionFunnelStatusPanel
							className="mx-1 my-1"
							event={completionFunnelSnapshot.event}
							showInternalDiagnostics={showInternalDiagnostics === true}
							terminalCompletion={completionFunnelSnapshot.terminalCompletion}
						/>
					) : null}

					{showAuditHistory && auditSnapshots ? (
						<AuditHistoryStrip
							auditHealth={auditHealth}
							checklistSummary={checklistSummary}
							embedded
							onScrollToAuditMessage={onScrollToAuditMessage}
							onScrollToLatestGateBlock={onScrollToLatestGateBlock}
							snapshots={auditSnapshots}
							subagentAuditSummary={subagentAuditSummary}
						/>
					) : null}

					{showPreCompletion ? (
						<PreCompletionGateStrip
							auditMetadata={latestAuditMetadata}
							embedded
							onScrollToLatestAdvisory={onScrollToLatestAdvisory}
							onScrollToLatestGateBlock={onScrollToLatestGateBlock}
						/>
					) : null}

					{showOrchestrator ? <OrchestratorGateStrip auditMetadata={latestAuditMetadata} embedded /> : null}

					{showViolations && auditSnapshots ? (
						<ViolationSessionLedgerStrip
							embedded
							onScrollToAuditMessage={onScrollToAuditMessage}
							snapshots={auditSnapshots}
						/>
					) : null}

					{showSubagent && subagentAuditSummary ? (
						<SubagentHandoffStrip embedded summary={subagentAuditSummary} />
					) : null}
				</div>
			</details>
		)
	},
)

TaskNotesSection.displayName = "TaskNotesSection"
