import type { SubagentStatusItem } from "@shared/ExtensionMessage"
import MarkdownBlock from "../../common/MarkdownBlock"

interface SubagentEvidencePanelProps {
	entry: SubagentStatusItem
}

export function SubagentEvidencePanel({ entry }: SubagentEvidencePanelProps) {
	const hasToolSteps = (entry.toolSteps?.length || 0) > 0
	const hasTouchedFiles = (entry.touchedFiles?.length || 0) > 0
	const hasBlockers = (entry.blockers?.length || 0) > 0
	const hasWarnings = (entry.warnings?.length || 0) > 0

	if (!hasToolSteps && !hasTouchedFiles && !hasBlockers && !hasWarnings) {
		return null
	}

	return (
		<div className="mt-2 space-y-2 text-[11px]">
			{hasBlockers && (
				<div>
					<div className="font-medium text-error mb-1">Blockers</div>
					<ul className="list-disc pl-4 space-y-0.5 text-error">
						{entry.blockers?.map((blocker) => (
							<li className="break-words" key={blocker}>
								{blocker}
							</li>
						))}
					</ul>
				</div>
			)}
			{hasWarnings && (
				<div>
					<div className="font-medium text-amber-700 dark:text-amber-400 mb-1">Warnings</div>
					<ul className="list-disc pl-4 space-y-0.5 opacity-80">
						{entry.warnings?.map((warning) => (
							<li className="break-words" key={warning}>
								{warning}
							</li>
						))}
					</ul>
				</div>
			)}
			{hasTouchedFiles && (
				<div>
					<div className="font-medium opacity-80 mb-1">Touched files</div>
					<ul className="font-mono opacity-70 space-y-0.5">
						{entry.touchedFiles?.map((filePath) => (
							<li className="break-all" key={filePath}>
								{filePath}
							</li>
						))}
					</ul>
				</div>
			)}
			{hasToolSteps && (
				<div>
					<div className="font-medium opacity-80 mb-1">Tool evidence chain</div>
					<ol className="space-y-1 opacity-80">
						{entry.toolSteps?.map((step) => (
							<li className="break-words" key={`${step.index}-${step.toolName}`}>
								<span className="font-mono">{step.index + 1}.</span> {step.toolName} — {step.preview}
							</li>
						))}
					</ol>
				</div>
			)}
			{entry.result && (
				<div>
					<div className="font-medium opacity-80 mb-1">Verbatim output</div>
					<div className="opacity-80 wrap-anywhere overflow-hidden">
						<MarkdownBlock markdown={entry.result} />
					</div>
				</div>
			)}
			{entry.error && (
				<div>
					<div className="font-medium text-error mb-1">Failure output</div>
					<div className="text-error whitespace-pre-wrap break-words">{entry.error}</div>
				</div>
			)}
		</div>
	)
}
