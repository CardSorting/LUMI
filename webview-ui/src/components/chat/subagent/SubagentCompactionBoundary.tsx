import type { SubagentStatusItem } from "@shared/ExtensionMessage"

interface SubagentCompactionBoundaryProps {
	entry: SubagentStatusItem
}

export function SubagentCompactionBoundary({ entry }: SubagentCompactionBoundaryProps) {
	if (!entry.compactionWarnings || entry.compactionWarnings.length === 0) {
		return null
	}

	return (
		<div className="mt-2 rounded-xs border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px]">
			<div className="font-medium text-amber-700 dark:text-amber-400 mb-1">Compaction boundary</div>
			<ul className="space-y-0.5 opacity-90">
				{entry.compactionWarnings.map((warning) => (
					<li className="break-words" key={warning}>
						{warning}
					</li>
				))}
			</ul>
			<div className="mt-1 opacity-70">
				Summaries below compaction boundaries are overlays, not raw transcript truth.
				{entry.transcriptEventCount !== undefined && ` Transcript events preserved: ${entry.transcriptEventCount}.`}
			</div>
		</div>
	)
}
