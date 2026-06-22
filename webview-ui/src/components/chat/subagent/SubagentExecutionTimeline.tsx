import type { DietCodeSaySubagentStatus, SubagentStatusItem } from "@shared/ExtensionMessage"
import { CheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react"

interface SubagentExecutionTimelineProps {
	status: DietCodeSaySubagentStatus
}

type TimelinePhase = "spawned" | "running" | "tooling" | "completed" | "failed"

function resolvePhase(entry: SubagentStatusItem): TimelinePhase {
	if (entry.status === "completed") return "completed"
	if (entry.status === "failed") return "failed"
	if ((entry.toolCalls || 0) > 0 || entry.latestToolCall) return "tooling"
	if (entry.status === "running") return "running"
	return "spawned"
}

const phaseLabel: Record<TimelinePhase, string> = {
	spawned: "Spawned",
	running: "Running",
	tooling: "Tooling",
	completed: "Completed",
	failed: "Failed",
}

const phaseIcon = (phase: TimelinePhase) => {
	switch (phase) {
		case "completed":
			return <CheckIcon className="size-2 text-success shrink-0" />
		case "failed":
			return <CircleXIcon className="size-2 text-error shrink-0" />
		case "running":
		case "tooling":
			return <LoaderCircleIcon className="size-2 text-link shrink-0 animate-spin" />
		default:
			return <span className="size-2 rounded-full bg-foreground/30 shrink-0 inline-block" />
	}
}

export function SubagentExecutionTimeline({ status }: SubagentExecutionTimelineProps) {
	return (
		<div className="mb-2 rounded-xs border border-editor-group-border px-2 py-1.5 text-[11px]">
			<div className="flex flex-wrap items-center gap-2 mb-2 opacity-80">
				<span className="font-medium">Execution timeline</span>
				{status.swarmId && <span className="font-mono opacity-70">swarm:{status.swarmId.slice(0, 8)}</span>}
				{status.continuityMarker && (
					<span className="font-mono opacity-70">
						{status.continuityMarker.completedAgents}/{status.continuityMarker.totalAgents} agents
					</span>
				)}
			</div>
			<div className="space-y-1">
				{status.items.map((entry) => {
					const phase = resolvePhase(entry)
					return (
						<div className="flex items-center gap-2 min-w-0" key={entry.index}>
							{phaseIcon(phase)}
							<span className="shrink-0 opacity-70">#{entry.index}</span>
							<span className="truncate opacity-90">{phaseLabel[phase]}</span>
							<span className="opacity-60 truncate">{entry.latestToolCall || entry.name}</span>
							{entry.evidenceCount !== undefined && entry.evidenceCount > 0 && (
								<span className="ml-auto shrink-0 opacity-60">{entry.evidenceCount} evidence</span>
							)}
						</div>
					)
				})}
			</div>
			{status.invariantViolations && status.invariantViolations.length > 0 && (
				<div className="mt-2 text-error whitespace-pre-wrap break-words">
					Invariant warnings: {status.invariantViolations.join("; ")}
				</div>
			)}
		</div>
	)
}
