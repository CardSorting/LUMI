import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { ResolvedCompletionFunnelSnapshot } from "@shared/completion/completionFunnelMessages"
import type { DietCodeMessage, TaskAuditMetadata } from "@shared/ExtensionMessage"
import {
	BadgeCheck,
	CheckCircle2,
	ChevronDown,
	CircleAlert,
	CircleDot,
	CircleStop,
	LoaderCircle,
	RefreshCw,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react"
import { memo, useMemo } from "react"
import { useIsCompact } from "@/context/DensityContext"
import { cn } from "@/lib/utils"
import { deriveExecutionStatus, type ExecutionState } from "./executionStatus"

interface ExecutionStatusHeaderProps {
	messages: readonly DietCodeMessage[]
	auditMetadata?: TaskAuditMetadata
	auditHealth?: AuditHealthSummary
	completionFunnel?: ResolvedCompletionFunnelSnapshot
	checkpointError?: string
	isDetailsOpen: boolean
	onToggleDetails: () => void
	onReviewBlock?: () => void
}

const STATE_STYLE: Record<ExecutionState, { panel: string; icon: string }> = {
	running: { panel: "border-link/25 bg-link/[0.035]", icon: "bg-link/10 text-link" },
	recovering: { panel: "border-link/30 bg-link/[0.045]", icon: "bg-link/12 text-link" },
	approval: {
		panel: "border-amber-500/35 bg-amber-500/[0.045]",
		icon: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
	},
	input: { panel: "border-link/20 bg-link/[0.025]", icon: "bg-link/10 text-link" },
	blocked: {
		panel: "border-amber-500/40 bg-amber-500/[0.055]",
		icon: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
	},
	failed: { panel: "border-error/35 bg-error/[0.045]", icon: "bg-error/10 text-error" },
	cancelled: { panel: "border-border/55 bg-foreground/[0.025]", icon: "bg-foreground/[0.07] text-description" },
	complete: { panel: "border-success/30 bg-success/[0.04]", icon: "bg-success/10 text-success" },
	ready: { panel: "border-border/50 bg-foreground/[0.018]", icon: "bg-foreground/[0.06] text-description" },
}

/** Compact safety pill text — keeps to ≤12 chars */
function compactSafety(safety: string): string {
	if (safety.length <= 12) return safety
	if (safety.startsWith("Gate")) return "Gate"
	if (safety.startsWith("Critical")) return "Critical"
	if (safety.startsWith("Review")) return "Review"
	if (safety.startsWith("Snapshot")) return "Stale"
	return `${safety.slice(0, 10)}…`
}

function StateIcon({ state }: { state: ExecutionState }) {
	const props = { "aria-hidden": true, className: "size-4", strokeWidth: 1.8 }
	switch (state) {
		case "running":
			return <LoaderCircle {...props} className="size-4 motion-safe:animate-spin" />
		case "recovering":
			return <RefreshCw {...props} className="size-4 motion-safe:animate-spin" />
		case "approval":
		case "blocked":
			return <ShieldAlert {...props} />
		case "failed":
			return <CircleAlert {...props} />
		case "complete":
			return <CheckCircle2 {...props} />
		case "cancelled":
			return <CircleStop {...props} />
		case "input":
			return <CircleDot {...props} />
		default:
			return <CircleDot {...props} />
	}
}

export const ExecutionStatusHeader = memo(
	({
		messages,
		auditMetadata,
		auditHealth,
		completionFunnel,
		checkpointError,
		isDetailsOpen,
		onToggleDetails,
		onReviewBlock,
	}: ExecutionStatusHeaderProps) => {
		const status = useMemo(
			() => deriveExecutionStatus({ messages, auditMetadata, auditHealth, completionFunnel, checkpointError }),
			[messages, auditMetadata, auditHealth, completionFunnel, checkpointError],
		)
		const style = STATE_STYLE[status.state]
		const isCompact = useIsCompact()

		return (
			<section
				aria-label="Current execution status"
				className={cn("overflow-hidden rounded-lg border shadow-sm shadow-black/[0.04]", style.panel)}
				data-execution-state={status.state}>
				{/* ── Row 1: State + Title + Safety pill + Chevron ── */}
				<div
					className={cn(
						"flex items-center gap-2",
						isCompact
							? isDetailsOpen
								? "px-2.5 py-2"
								: "px-2 py-1"
							: isDetailsOpen
								? "items-start gap-2.5 p-3"
								: "items-center gap-2 px-3 py-1.5",
					)}>
					<div
						className={cn(
							"flex shrink-0 items-center justify-center rounded-md",
							style.icon,
							isCompact || !isDetailsOpen ? "size-5" : "size-7",
						)}>
						<StateIcon state={status.state} />
					</div>
					<div aria-atomic="true" aria-live="polite" className="min-w-0 flex-1">
						{!isCompact && isDetailsOpen && (
							<p className="m-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-description/75">
								Execution status
							</p>
						)}
						<h2
							className={cn(
								"font-semibold leading-tight text-foreground",
								isCompact || !isDetailsOpen ? "text-[11px] m-0 truncate" : "mt-0.5 text-[13px]",
							)}>
							{status.title}
						</h2>
						{/* Detail text — hidden at compact density, short heights, or when collapsed */}
						{!isCompact && isDetailsOpen && (
							<p
								className={cn(
									"lumi-execution-detail mt-1 text-[11px] leading-[1.45] text-description",
									status.state === "approval" && "hidden",
								)}>
								{status.detail}
							</p>
						)}
					</div>
					{/* Safety pill — visible when collapsed as inline indicator */}
					{(isCompact || !isDetailsOpen) && (
						<span
							className={cn(
								"shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-medium leading-none",
								status.state === "blocked" || status.state === "failed"
									? "border-error/30 bg-error/[0.06] text-error"
									: status.state === "complete"
										? "border-success/25 bg-success/[0.06] text-success"
										: "border-description/20 bg-foreground/[0.04] text-description",
							)}
							title={`Safety: ${status.safety} · Completion: ${status.confidence}`}>
							{compactSafety(status.safety)}
						</span>
					)}
					<button
						aria-expanded={isDetailsOpen}
						aria-label={isDetailsOpen ? "Hide task details" : "Show task details"}
						className={cn(
							"flex shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-description transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							isCompact || !isDetailsOpen ? "-mr-0.5 size-5" : "-mr-1 size-7",
						)}
						onClick={onToggleDetails}
						title={isDetailsOpen ? "Hide task details" : "Show task details"}
						type="button">
						<ChevronDown
							aria-hidden
							className={cn(
								isCompact || !isDetailsOpen ? "size-3" : "size-4",
								"transition-transform",
								!isDetailsOpen && "-rotate-90",
							)}
							strokeWidth={1.8}
						/>
					</button>
				</div>

				{/* ── Row 2: Next action (visible when expanded) ── */}
				{isDetailsOpen && (
					<div className={cn("border-t border-current/10 bg-background/25", isCompact ? "px-2.5 py-1.5" : "px-3 py-2")}>
						<div className="flex items-start gap-2">
							<span
								className={cn(
									"shrink-0 font-semibold uppercase tracking-[0.1em] text-description/70",
									isCompact ? "text-[8px]" : "text-[9px]",
								)}>
								Next
							</span>
							<span
								className={cn(
									"min-w-0 flex-1 leading-[1.4] text-foreground/90",
									isCompact ? "text-[9px]" : "text-[10px]",
								)}>
								{status.nextAction}
							</span>
							{status.state === "blocked" && onReviewBlock ? (
								<button
									className="shrink-0 rounded border border-amber-500/40 bg-transparent px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
									onClick={onReviewBlock}
									type="button">
									Review
								</button>
							) : null}
						</div>
					</div>
				)}

				{/* ── Row 3: Safety + Completion grid (visible when expanded) ── */}
				{isDetailsOpen && (
					<div
						className={cn(
							"lumi-execution-meta border-t border-current/10 bg-background/15",
							isCompact ? "flex flex-wrap" : "grid grid-cols-2",
						)}>
						<div
							className={cn(
								"flex min-w-0 items-center gap-1.5",
								isCompact ? "flex-1 min-w-[120px] px-2.5 py-1.5" : "border-r border-current/10 px-3 py-2",
							)}>
							{status.state === "blocked" || status.state === "failed" ? (
								<ShieldAlert
									aria-hidden
									className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300"
									strokeWidth={1.8}
								/>
							) : (
								<ShieldCheck aria-hidden className="size-3.5 shrink-0 text-description" strokeWidth={1.8} />
							)}
							<div className="min-w-0">
								<p className="m-0 text-[8px] font-medium uppercase tracking-wide text-description/65">Safety</p>
								<p className="m-0 truncate text-[10px] font-medium text-foreground/90" title={status.safety}>
									{status.safety}
								</p>
							</div>
						</div>
						<div
							className={cn(
								"flex min-w-0 items-center gap-1.5",
								isCompact ? "flex-1 min-w-[120px] px-2.5 py-1.5" : "px-3 py-2",
							)}>
							<BadgeCheck aria-hidden className="size-3.5 shrink-0 text-description" strokeWidth={1.8} />
							<div className="min-w-0">
								<p className="m-0 text-[8px] font-medium uppercase tracking-wide text-description/65">
									Completion
								</p>
								<p className="m-0 truncate text-[10px] font-medium text-foreground/90" title={status.confidence}>
									{status.confidence}
								</p>
							</div>
						</div>
					</div>
				)}
			</section>
		)
	},
)

ExecutionStatusHeader.displayName = "ExecutionStatusHeader"
