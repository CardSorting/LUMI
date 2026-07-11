import type { GovernedReceiptIncident, GovernedReceiptSummary } from "@shared/ExtensionMessage"
import { CheckIcon, CircleXIcon, LockIcon, ShieldAlertIcon, ShieldCheckIcon, TimerIcon } from "lucide-react"

interface GovernedReceiptPanelProps {
	receipt: GovernedReceiptSummary
}

const INCIDENT_LABELS: Record<GovernedReceiptIncident, string> = {
	sealed_success: "Sealed success",
	partial_receipt: "Partial receipt",
	failed_receipt: "Failed receipt",
	stale_claim: "Stale claim",
	unsafe_retry: "Unsafe retry",
	corrupted_receipt: "Corrupted receipt",
	replay_mismatch: "Replay mismatch",
	backend_unavailable: "Backend unavailable",
	merge_blocked: "Merge blocked",
	in_progress: "In progress",
}

const incidentClass = (incident: GovernedReceiptIncident): string => {
	switch (incident) {
		case "sealed_success":
			return "bg-success/15 text-success border-success/25"
		case "in_progress":
		case "partial_receipt":
			return "bg-link/15 text-link border-link/25"
		case "stale_claim":
		case "unsafe_retry":
		case "merge_blocked":
			return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25"
		default:
			return "bg-error/15 text-error border-error/25"
	}
}

const laneStatusClass = (status: string): string => {
	switch (status) {
		case "completed":
			return "text-success"
		case "failed":
		case "collision_rejected":
			return "text-error"
		case "skipped":
			return "text-foreground/60"
		case "running":
			return "text-link"
		default:
			return "text-foreground/70"
	}
}

const dagStateClass = (state?: string): string => {
	switch (state) {
		case "sealed":
			return "bg-success/15 text-success border-success/25"
		case "failed":
			return "bg-error/15 text-error border-error/25"
		case "blocked":
			return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25"
		case "running":
			return "bg-link/15 text-link border-link/25"
		default:
			return "bg-foreground/10 text-foreground/70 border-foreground/20"
	}
}

const backendLabel = (backends?: GovernedReceiptSummary["resourceOwners"][0]["lockBackends"]): string => {
	if (!backends) {
		return "—"
	}
	const parts: string[] = []
	if (backends.inProcess) parts.push("proc")
	if (backends.swarmMutex) parts.push("db")
	if (backends.roadmapLease) parts.push("lease")
	if (backends.fileLock) parts.push("file")
	if (backends.broccoliFence) parts.push("fence")
	return parts.join("+") || "—"
}

export function GovernedReceiptPanel({ receipt }: GovernedReceiptPanelProps) {
	const { diagnostics } = receipt
	const incident = diagnostics?.incident ?? (receipt.sealed ? "sealed_success" : "failed_receipt")
	const sealIcon =
		incident === "sealed_success" ? (
			<ShieldCheckIcon className="size-3 text-success shrink-0" />
		) : incident === "in_progress" || incident === "partial_receipt" ? (
			<TimerIcon className="size-3 text-link shrink-0" />
		) : (
			<ShieldAlertIcon className="size-3 text-error shrink-0" />
		)

	return (
		<div className="mt-2 rounded border border-foreground/15 bg-foreground/[0.03] p-2 space-y-2">
			<div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-foreground/70">
				{sealIcon}
				<span>Incident console</span>
				<span className="text-foreground/40">·</span>
				<span>{receipt.attemptId.slice(0, 8)}</span>
				{receipt.parentAttemptId && (
					<>
						<span className="text-foreground/40">←</span>
						<span className="text-foreground/50">{receipt.parentAttemptId.slice(0, 8)}</span>
					</>
				)}
			</div>

			<div className={`text-[10px] font-mono rounded border px-1.5 py-1 ${incidentClass(incident)}`}>
				<span className="uppercase tracking-wide">{INCIDENT_LABELS[incident]}</span>
				<span className="text-foreground/50"> — </span>
				<span>{diagnostics?.incidentSummary || receipt.violations[0] || "Awaiting final seal."}</span>
			</div>

			<div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
				<div>
					Running: <span className="text-link">{receipt.lanesRunning}</span>
				</div>
				<div>
					Retry safe:{" "}
					<span className={diagnostics?.retrySafe ? "text-success" : "text-error"}>
						{diagnostics?.retrySafe ? "yes" : "no"}
					</span>
				</div>
				<div>
					Retry action: <span className="text-foreground/70">{receipt.retryDisposition || "legacy receipt"}</span>
				</div>
				<div>
					Continuation: <span className="text-foreground/70">{receipt.continuationDecision?.action || "legacy"}</span>
				</div>
				<div>
					Authoritative:{" "}
					<span className="text-foreground/70 truncate" title={diagnostics?.authoritativeAttemptId}>
						{diagnostics?.authoritativeAttemptId?.slice(0, 8) || "—"}
					</span>
				</div>
				<div>
					Merge gate:{" "}
					<span className={receipt.mergePassed ? "text-success" : "text-error"}>
						{receipt.mergePassed ? "passed" : "blocked"}
					</span>
				</div>
				<div>
					Still owned:{" "}
					<span className={(diagnostics?.activeResourceOwners.length ?? 0) > 0 ? "text-error" : "text-success"}>
						{diagnostics?.activeResourceOwners.length ?? 0}
					</span>
				</div>
				<div>
					Stale claims:{" "}
					<span className={(diagnostics?.staleResourceOwners.length ?? 0) > 0 ? "text-error" : "text-success"}>
						{diagnostics?.staleResourceOwners.length ?? 0}
					</span>
				</div>
				<div>
					Evidence:{" "}
					<span className={receipt.evidenceComplete ? "text-success" : "text-amber-600 dark:text-amber-400"}>
						{receipt.evidenceComplete ? "complete" : "incomplete"}
					</span>
				</div>
				<div>
					Replay:{" "}
					<span className={receipt.replayIntegrityValid ? "text-success" : "text-error"}>
						{receipt.replayIntegrityValid ? "valid" : "invalid"}
					</span>
				</div>
			</div>

			{!diagnostics?.retrySafe && diagnostics?.retryUnsafeReason && (
				<div className="text-[10px] font-mono text-error/90 bg-error/10 border border-error/20 rounded px-1.5 py-1">
					Retry unsafe: {diagnostics.retryUnsafeReason}
				</div>
			)}

			{(diagnostics?.overlappingPaths.length ?? 0) > 0 && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-foreground/50">File overlaps</div>
					{diagnostics!.overlappingPaths.map((overlap) => (
						<div className="text-[10px] font-mono text-foreground/70" key={overlap.path}>
							{overlap.path} → {overlap.agents.join(", ")}
						</div>
					))}
				</div>
			)}

			{(diagnostics?.overlappingRoadmapResources?.length ?? 0) > 0 && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Roadmap overlaps</div>
					{diagnostics!.overlappingRoadmapResources!.map((overlap) => (
						<div className="text-[10px] font-mono text-foreground/70" key={overlap.resource}>
							{overlap.resource} → {overlap.agents.join(", ")}
						</div>
					))}
				</div>
			)}

			{(diagnostics?.blockedRoadmapWriters?.length ?? 0) > 0 && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-amber-600 dark:text-amber-400">
						Blocked roadmap writers
					</div>
					{diagnostics!.blockedRoadmapWriters!.map((writer) => (
						<div className="text-[10px] font-mono text-amber-700 dark:text-amber-400" key={writer}>
							{writer}
						</div>
					))}
				</div>
			)}

			{(diagnostics?.roadmapCommitStatus || receipt.roadmapLinkage?.patchReconciliation) && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Roadmap planes</div>
					{diagnostics?.workspaceRoadmapSnapshotId && (
						<div className="text-[10px] font-mono text-foreground/60">
							workspace snap: {diagnostics.workspaceRoadmapSnapshotId.slice(0, 20)}
						</div>
					)}
					{receipt.roadmapLinkage?.swarmRoadmapPlan && (
						<div className="text-[10px] font-mono text-foreground/60">
							swarm plan: {receipt.roadmapLinkage.swarmRoadmapPlan.laneItemIds.length} lanes
						</div>
					)}
					{(receipt.roadmapLinkage?.agentProjections?.length ?? 0) > 0 && (
						<div className="text-[10px] font-mono text-foreground/60">
							agent projections: {receipt.roadmapLinkage!.agentProjections!.length}
						</div>
					)}
					{receipt.roadmapLinkage?.patchReconciliation && (
						<>
							<div className="text-[10px] font-mono text-foreground/60">
								accepted patches: {receipt.roadmapLinkage.patchReconciliation.acceptedPatches.length}
							</div>
							<div className="text-[10px] font-mono text-foreground/60">
								rejected patches: {receipt.roadmapLinkage.patchReconciliation.rejectedPatches.length}
							</div>
							{receipt.roadmapLinkage.patchReconciliation.rebaseResults.map((rebase) => (
								<div className="text-[10px] font-mono text-foreground/50" key={rebase.patchId}>
									rebase {rebase.patchId.slice(0, 8)}: {rebase.outcome}
									{rebase.reason ? ` — ${rebase.reason}` : ""}
								</div>
							))}
						</>
					)}
					{(diagnostics?.rejectedPatchReasons?.length ?? 0) > 0 && (
						<div className="space-y-0.5">
							<div className="text-[9px] font-mono uppercase text-error/70">Rejected patch reasons</div>
							{diagnostics!.rejectedPatchReasons!.map((reason) => (
								<div className="text-[10px] font-mono text-error/80 break-words" key={reason}>
									{reason}
								</div>
							))}
						</div>
					)}
					{diagnostics?.roadmapCommitStatus && (
						<div className="text-[10px] font-mono text-link/80">commit: {diagnostics.roadmapCommitStatus}</div>
					)}
					{(diagnostics?.staleProjectionWarnings?.length ?? 0) > 0 && (
						<div className="text-[10px] font-mono text-amber-700 dark:text-amber-400">
							stale projections: {diagnostics!.staleProjectionWarnings!.join(", ")}
						</div>
					)}
				</div>
			)}

			{(diagnostics?.roadmapCompletionAdvisory || receipt.roadmapLinkage?.completionOutcome) && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Roadmap completion</div>
					{receipt.roadmapLinkage?.completionOutcome?.status === "updated" ? (
						<div className="text-[10px] font-mono text-success">committed roadmap update</div>
					) : (
						<div className="text-[10px] font-mono text-foreground/60">
							advisory only
							{diagnostics?.roadmapCompletionAdvisory ? ` — ${diagnostics.roadmapCompletionAdvisory}` : ""}
						</div>
					)}
				</div>
			)}

			{((diagnostics?.missingTranscripts.length ?? 0) > 0 || (diagnostics?.missingToolEvidence.length ?? 0) > 0) && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-amber-600 dark:text-amber-400">Evidence advisories</div>
					{diagnostics?.missingTranscripts.map((laneId) => (
						<div className="text-[10px] font-mono text-foreground/60" key={`t-${laneId}`}>
							transcript: {laneId}
						</div>
					))}
					{diagnostics?.missingToolEvidence.map((laneId) => (
						<div className="text-[10px] font-mono text-foreground/60" key={`e-${laneId}`}>
							tool steps: {laneId}
						</div>
					))}
				</div>
			)}

			{(diagnostics?.replayMismatchCauses.length ?? 0) > 0 && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-error/80">Replay mismatch</div>
					{diagnostics!.replayMismatchCauses.map((cause) => (
						<div className="text-[10px] font-mono text-error/90 break-words" key={cause}>
							{cause}
						</div>
					))}
				</div>
			)}

			{receipt.laneDag.length > 0 && (
				<div className="space-y-1">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Lane DAG</div>
					{receipt.laneDag.map((lane) => (
						<div className="flex items-center gap-1.5 text-[10px] font-mono" key={lane.laneId}>
							<span className="text-foreground/60">L{lane.index + 1}</span>
							<span className={`px-1 rounded-[2px] border text-[9px] ${dagStateClass(lane.state)}`}>
								{lane.state}
							</span>
							{lane.dependsOn.length > 0 && (
								<span className="text-foreground/40">
									dep: {lane.dependsOn.map((d) => `L${d + 1}`).join(",")}
								</span>
							)}
							{lane.agentId && <span className="text-foreground/40 truncate">{lane.agentId}</span>}
						</div>
					))}
				</div>
			)}

			{receipt.resourceOwners.length > 0 && (
				<div className="space-y-1">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Resource ownership</div>
					{receipt.resourceOwners.map((owner) => (
						<div
							className="flex items-center gap-1.5 text-[10px] font-mono"
							key={`${owner.resourceKey}-${owner.ownerId}`}>
							<LockIcon className="size-2 shrink-0 text-foreground/40" />
							<span
								className={`${owner.status === "active" ? "text-link" : owner.status === "stale" ? "text-error" : "text-foreground/50"}`}>
								{owner.status}
							</span>
							<span
								className={`text-foreground/40 truncate max-w-[120px] ${owner.resourceKey.startsWith("roadmap:") ? "text-link/80" : ""}`}
								title={owner.resourceKey}>
								{owner.resourceKey.startsWith("roadmap:")
									? owner.resourceKey
									: owner.resourceKey.split(":").pop()}
							</span>
							<span className="text-foreground/50">{owner.ownerId}</span>
							<span className="text-foreground/30">t{owner.fencingToken}</span>
							<span className="text-foreground/30" title="lock backends">
								{backendLabel(owner.lockBackends)}
							</span>
						</div>
					))}
				</div>
			)}

			{receipt.claimTimeline.length > 0 && (
				<div className="space-y-1">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Claim timeline</div>
					{receipt.claimTimeline.map((entry) => (
						<div
							className="flex items-center gap-1.5 text-[10px] font-mono"
							key={`${entry.event}-${entry.timestamp}-${entry.laneId || ""}-${entry.claimId || ""}`}>
							<span
								className={
									entry.status === "ok"
										? "text-success"
										: entry.status === "failed"
											? "text-error"
											: "text-amber-600 dark:text-amber-400"
								}>
								{entry.label}
							</span>
							{entry.laneId && <span className="text-foreground/40 truncate">{entry.laneId}</span>}
							{entry.claimId && <span className="text-foreground/30">{entry.claimId.slice(0, 8)}</span>}
						</div>
					))}
				</div>
			)}

			{receipt.laneStates.length > 0 && (
				<div className="space-y-1">
					<div className="text-[9px] font-mono uppercase text-foreground/50">Lane receipts</div>
					{receipt.laneStates.map((lane) => (
						<div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono" key={lane.laneId}>
							<span className="text-foreground/60">L{lane.index + 1}</span>
							<span className={laneStatusClass(lane.status)}>{lane.status}</span>
							{lane.executionMode && (
								<span className="text-foreground/50 px-1 border border-foreground/15 rounded-[2px]">
									{lane.executionMode}
								</span>
							)}
							{lane.lockRequired === false && (
								<span className="text-success/80" title={lane.reasonLockSkipped}>
									lock skipped
								</span>
							)}
							{lane.lockRequired && (
								<span className="text-link/80" title={lane.reasonLockAcquired}>
									lock required
								</span>
							)}
							{lane.readSet && lane.readSet.length > 0 && (
								<span className="text-foreground/40">read:{lane.readSet.length}</span>
							)}
							{lane.writeSet && lane.writeSet.length > 0 && (
								<span className="text-amber-600 dark:text-amber-400">write:{lane.writeSet.length}</span>
							)}
							{lane.roadmapReadSet && lane.roadmapReadSet.length > 0 && (
								<span className="text-foreground/40" title={lane.roadmapReadSet.join(", ")}>
									rm-read:{lane.roadmapReadSet.length}
								</span>
							)}
							{lane.roadmapWriteSet && lane.roadmapWriteSet.length > 0 && (
								<span className="text-amber-600 dark:text-amber-400" title={lane.roadmapWriteSet.join(", ")}>
									rm-write:{lane.roadmapWriteSet.length}
								</span>
							)}
							{lane.roadmapMutationLockRequired && (
								<span className="text-link/80" title={lane.reasonRoadmapLockAcquired}>
									roadmap lock
								</span>
							)}
							{lane.roadmapMutationLockRequired === false && lane.roadmapWriteSet?.length ? (
								<span className="text-error/80">roadmap lock skipped</span>
							) : null}
							{lane.proposedWorkspacePatch && lane.proposedWorkspacePatch.length > 0 && (
								<span className="text-link/70">patches:{lane.proposedWorkspacePatch.length}</span>
							)}
							{lane.localRoadmapEvents && lane.localRoadmapEvents.length > 0 && (
								<span className="text-foreground/40">local:{lane.localRoadmapEvents.length}</span>
							)}
							{lane.agentRoadmapId && (
								<span className="text-foreground/30 truncate max-w-[80px]" title={lane.agentRoadmapId}>
									{lane.agentRoadmapId.split(":").pop()}
								</span>
							)}
							{lane.evidenceCount !== undefined && (
								<span className="text-foreground/40">ev:{lane.evidenceCount}</span>
							)}
							{lane.claimId && <span className="text-foreground/30">{lane.claimId.slice(0, 8)}</span>}
						</div>
					))}
				</div>
			)}

			{receipt.retryHistory.length > 0 && (
				<div className="space-y-1">
					<div className="text-[9px] font-mono uppercase text-foreground/50 flex items-center gap-1">
						<TimerIcon className="size-2" />
						Retry lineage
					</div>
					{receipt.retryHistory.map((entry) => (
						<div className="text-[10px] font-mono text-foreground/60" key={entry.attemptId}>
							{entry.attemptId.slice(0, 8)}
							{entry.parentAttemptId && ` ← ${entry.parentAttemptId.slice(0, 8)}`}
							{" · "}
							<span className={entry.sealed ? "text-success" : "text-error"}>
								{entry.sealed ? "sealed" : "unsealed"}
							</span>
							{" · "}
							<span className={entry.mergePassed ? "text-success" : "text-error"}>
								{entry.mergePassed ? "merge ok" : "merge fail"}
							</span>
							{entry.retryReason && <span className="text-foreground/40"> · {entry.retryReason}</span>}
						</div>
					))}
				</div>
			)}

			{receipt.violations.length > 0 && (
				<div className="space-y-0.5">
					<div className="text-[9px] font-mono uppercase text-error/80">Merge violations</div>
					{receipt.violations.slice(0, 5).map((violation) => (
						<div className="text-[10px] text-error/90 font-mono break-words" key={violation}>
							{violation}
						</div>
					))}
				</div>
			)}

			{(receipt.advisoryWarnings?.length ?? 0) > 0 && (
				<div className="space-y-0.5 rounded border border-amber-500/20 bg-amber-500/5 px-1.5 py-1">
					<div className="text-[9px] font-mono uppercase text-amber-600 dark:text-amber-400">
						Audit advisories · no retry required
					</div>
					{receipt.advisoryWarnings?.slice(0, 5).map((warning) => (
						<div className="text-[10px] text-foreground/70 font-mono break-words" key={warning}>
							{warning}
						</div>
					))}
				</div>
			)}

			<div className="flex items-center gap-2 text-[9px] font-mono text-foreground/50">
				{receipt.sealed ? <CheckIcon className="size-2 text-success" /> : <CircleXIcon className="size-2 text-error" />}
				<span className="truncate" title={receipt.governedArtifactPath}>
					{receipt.governedArtifactPath}
				</span>
				{receipt.replayChecksum && (
					<span className="text-foreground/30 truncate" title={receipt.replayChecksum}>
						#{receipt.replayChecksum.slice(0, 8)}
					</span>
				)}
			</div>
		</div>
	)
}
