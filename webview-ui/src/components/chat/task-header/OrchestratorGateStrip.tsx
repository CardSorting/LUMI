import { buildOrchestratorGateStatus } from "@shared/audit/auditOrchestratorDigest"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon, NetworkIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { useAuditGateEvaluation } from "@/hooks/useAuditGateEvaluation"
import { cn } from "@/lib/utils"
import { auditStrip } from "../audit/auditUiStyles"
import { AuditArtifactQuickLinks } from "./AuditArtifactQuickLinks"

interface OrchestratorGateStripProps {
	auditMetadata?: TaskAuditMetadata
	className?: string
}

/** Swarm/orchestrator gate digest — mirrors GitHub Actions workflow gate summary for parent tasks. */
export const OrchestratorGateStrip = memo(({ auditMetadata, className }: OrchestratorGateStripProps) => {
	const [expanded, setExpanded] = useState(false)
	const gateOptions = useAuditGateEvaluation(auditMetadata)
	const status = useMemo(() => buildOrchestratorGateStatus(auditMetadata, gateOptions), [auditMetadata, gateOptions])

	if (!status || !auditMetadata || gateOptions.gateEnabled === false) {
		return null
	}

	const hasArtifacts = Boolean(status.artifactSarifPath || status.artifactReportPath || status.artifactManifestPath)
	const shouldShow = !status.ready || hasArtifacts || status.criticalViolationCount > 0
	if (!shouldShow) {
		return null
	}

	return (
		<section
			aria-label="A quick look"
			className={cn(
				"mt-2 px-3 py-2.5 text-[10px] mira-audit-exhale transition-opacity duration-[2s]",
				auditStrip,
				className,
			)}>
			<button
				aria-expanded={expanded}
				className="flex w-full items-center justify-between cursor-pointer bg-transparent border-0 p-0 text-left font-sans"
				onClick={() => setExpanded(!expanded)}
				type="button">
				<div className="flex items-center gap-2 flex-wrap">
					<NetworkIcon className="size-3 shrink-0 text-description/70" />
					<span className="font-medium text-description/85">A quick look</span>
					<span
						className={cn(
							"px-2 py-0.5 rounded-full text-[9px] font-medium border",
							status.ready
								? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
								: "border-amber-500/40 text-amber-700 dark:text-amber-400",
						)}>
						{status.ready ? "Looking good" : "Worth revisiting"}
					</span>
					<span className="font-mono text-description/70">
						{status.score}/{status.effectiveThreshold}
					</span>
					{status.gateBlockCount ? (
						<span className="text-amber-700 dark:text-amber-400">
							{status.gateBlockCount} pause{status.gateBlockCount === 1 ? "" : "s"}
						</span>
					) : null}
				</div>
				{expanded ? (
					<ChevronDownIcon className="size-3 text-description/60" />
				) : (
					<ChevronRightIcon className="size-3 text-description/60" />
				)}
			</button>

			{expanded && (
				<div className="mt-2 space-y-1.5">
					{status.reasonLabels.length > 0 && (
						<ul className="list-disc list-inside text-amber-800/90 dark:text-amber-300/90 space-y-0.5">
							{status.reasonLabels.map((label) => (
								<li className="break-words" key={label}>
									{label}
								</li>
							))}
						</ul>
					)}
					{(status.criticalViolationCount > 0 || status.warningViolationCount > 0) && (
						<p className="text-description/75">
							{status.criticalViolationCount > 0 && (
								<span className="text-amber-700 dark:text-amber-400">
									{status.criticalViolationCount} needs attention{" "}
								</span>
							)}
							{status.warningViolationCount > 0 && (
								<span className="text-amber-600 dark:text-amber-400">
									{status.warningViolationCount} to review
								</span>
							)}
						</p>
					)}
					<AuditArtifactQuickLinks auditMetadata={auditMetadata} />
				</div>
			)}

			{!expanded && hasArtifacts && <AuditArtifactQuickLinks auditMetadata={auditMetadata} className="mt-1.5" />}
		</section>
	)
})

OrchestratorGateStrip.displayName = "OrchestratorGateStrip"
