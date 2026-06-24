import type { GovernedReceiptSummary } from "@shared/ExtensionMessage"
import { CheckIcon, CircleXIcon, LockIcon, ShieldAlertIcon, ShieldCheckIcon, TimerIcon } from "lucide-react"

interface GovernedReceiptPanelProps {
	receipt: GovernedReceiptSummary
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
	const sealIcon = receipt.sealed ? (
		<ShieldCheckIcon className="size-3 text-success shrink-0" />
	) : (
		<ShieldAlertIcon className="size-3 text-error shrink-0" />
	)

	const blockedReason =
		receipt.violations[0] ||
		(!receipt.admitted ? receipt.admissionReason : undefined) ||
		(receipt.lanesBlocked > 0 ? "DAG dependencies not satisfied" : undefined)

	return (
		<div className="mt-2 rounded border border-foreground/15 bg-foreground/[0.03] p-2 space-y-2">
			<div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-foreground/70">
				{sealIcon}
				<span>Governed operator console</span>
				<span className="text-foreground/40">·</span>
				<span>{receipt.attemptId.slice(0, 8)}</span>
				{receipt.parentAttemptId && (
					<>
						<span className="text-foreground/40">←</span>
						<span className="text-foreground/50">{receipt.parentAttemptId.slice(0, 8)}</span>
					</>
				)}
			</div>

			<div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
				<div>
					Running: <span className="text-link">{receipt.lanesRunning}</span>
				</div>
				<div>
					Blocked:{" "}
					<span className={receipt.lanesBlocked > 0 ? "text-amber-600" : "text-foreground/60"}>
						{receipt.lanesBlocked}
					</span>
				</div>
				<div>
					Admitted:{" "}
					<span className={receipt.admitted ? "text-success" : "text-error"}>{receipt.admitted ? "yes" : "no"}</span>
				</div>
				<div>
					Merge gate:{" "}
					<span className={receipt.mergePassed ? "text-success" : "text-error"}>
						{receipt.mergePassed ? "passed" : "blocked"}
					</span>
				</div>
				<div>
					Sealed:{" "}
					<span className={receipt.sealed ? "text-success" : "text-error"}>{receipt.sealed ? "yes" : "no"}</span>
				</div>
				<div>
					Evidence:{" "}
					<span className={receipt.evidenceComplete ? "text-success" : "text-error"}>
						{receipt.evidenceComplete ? "complete" : "incomplete"}
					</span>
				</div>
				<div>
					Replay:{" "}
					<span className={receipt.replayIntegrityValid ? "text-success" : "text-error"}>
						{receipt.replayIntegrityValid ? "valid" : "invalid"}
					</span>
				</div>
				<div>
					Split-brain:{" "}
					<span className={receipt.splitBrainDetected ? "text-error" : "text-success"}>
						{receipt.splitBrainDetected ? "detected" : "none"}
					</span>
				</div>
			</div>

			{blockedReason && !receipt.mergePassed && (
				<div className="text-[10px] font-mono text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-1">
					Blocked: {blockedReason}
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
							<span className="text-foreground/40 truncate max-w-[120px]" title={owner.resourceKey}>
								{owner.resourceKey.split(":").pop()}
							</span>
							<span className="text-foreground/50">{owner.ownerId}</span>
							<span className="text-foreground/30">t{owner.fencingToken}</span>
							<span className="text-foreground/30">{backendLabel(owner.lockBackends)}</span>
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
						<div className="flex items-center gap-1.5 text-[10px] font-mono" key={lane.laneId}>
							<span className="text-foreground/60">L{lane.index + 1}</span>
							<span className={laneStatusClass(lane.status)}>{lane.status}</span>
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
						Retry history
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
					{receipt.violations.length > 5 && (
						<div className="text-[9px] text-foreground/50">+{receipt.violations.length - 5} more</div>
					)}
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
