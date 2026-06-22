import type { ExecutionDiffReport } from "@shared/execution/statusDiff"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"

interface SubagentExecutionDiffViewerProps {
	diff: ExecutionDiffReport
	leftLabel: string
	rightLabel: string
	error?: string
}

const changeClass = (kind: ExecutionDiffReport["agentDiffs"][number]["changeKind"]): string => {
	switch (kind) {
		case "added":
			return "text-success"
		case "removed":
			return "text-error"
		case "changed":
			return "text-amber-700 dark:text-amber-400"
		default:
			return "opacity-70"
	}
}

export function SubagentExecutionDiffViewer({ diff, leftLabel, rightLabel, error }: SubagentExecutionDiffViewerProps) {
	const [expanded, setExpanded] = useState(false)
	const [rawExpanded, setRawExpanded] = useState(false)

	if (error) {
		return <div className="text-error text-[11px] break-words">Diff unavailable: {error}</div>
	}

	const changedAgents = diff.agentDiffs.filter((agent) => agent.changeKind !== "unchanged")

	return (
		<div className="mb-2 rounded-xs border border-editor-group-border px-2 py-1.5 text-[11px]">
			<div className="flex items-center gap-2 flex-wrap">
				<span className="font-medium">Execution diff</span>
				<span className="opacity-70">
					{leftLabel} → {rightLabel}
				</span>
			</div>
			<div className="mt-1 opacity-80">{diff.summary}</div>
			{diff.identical ? (
				<div className="mt-1 opacity-70">No tracked differences.</div>
			) : (
				<div className="mt-2 space-y-1">
					<div className="opacity-70">
						Changed agents: {changedAgents.length} · Transcript delta: {diff.transcriptDeltaTotal}
					</div>
					{changedAgents.slice(0, expanded ? changedAgents.length : 3).map((agent) => (
						<div className="flex flex-wrap gap-2 min-w-0" key={agent.agentId}>
							<span className={changeClass(agent.changeKind)}>{agent.changeKind}</span>
							<span>#{agent.index ?? agent.agentId}</span>
							<span>{agent.label}</span>
							{agent.statusBefore && agent.statusAfter && agent.statusBefore !== agent.statusAfter && (
								<span>
									{agent.statusBefore} → {agent.statusAfter}
								</span>
							)}
							{agent.transcriptEventDelta !== 0 && (
								<span>
									transcript {agent.transcriptEventDelta > 0 ? "+" : ""}
									{agent.transcriptEventDelta}
								</span>
							)}
							{agent.evidenceDelta !== 0 && (
								<span>
									evidence {agent.evidenceDelta > 0 ? "+" : ""}
									{agent.evidenceDelta}
								</span>
							)}
						</div>
					))}
				</div>
			)}
			{changedAgents.length > 3 && (
				<button
					className="mt-1 text-[11px] opacity-80 flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-foreground"
					onClick={() => setExpanded((value) => !value)}
					type="button">
					{expanded ? <ChevronDownIcon className="size-2" /> : <ChevronRightIcon className="size-2" />}
					{expanded ? "Show fewer changes" : `Show all ${changedAgents.length} changes`}
				</button>
			)}
			<button
				className="mt-1 text-[11px] opacity-80 flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-foreground"
				onClick={() => setRawExpanded((value) => !value)}
				type="button">
				{rawExpanded ? <ChevronDownIcon className="size-2" /> : <ChevronRightIcon className="size-2" />}
				{rawExpanded ? "Hide raw diff" : "Show raw diff"}
			</button>
			{rawExpanded && (
				<pre className="mt-2 text-[10px] opacity-80 overflow-auto max-h-48 whitespace-pre-wrap break-words">
					{JSON.stringify(diff, null, 2)}
				</pre>
			)}
		</div>
	)
}
