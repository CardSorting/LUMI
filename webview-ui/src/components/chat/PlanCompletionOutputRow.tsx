import { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { NotepadTextIcon } from "lucide-react"
import { memo } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { cn } from "@/lib/utils"
import { AuditReportPanel } from "./AuditReportPanel"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
	headClassNames?: string
	auditMetadata?: TaskAuditMetadata
	isStreaming?: boolean
}

/**
 * Styled completion output for Plan Mode responses.
 * Uses grayscale colors to distinguish from Act Mode's green success theme.
 */
const PlanCompletionOutputRow = memo(({ text, headClassNames, auditMetadata, isStreaming }: PlanCompletionOutputProps) => {
	return (
		<div className="rounded-lg border border-description/40 overflow-visible bg-code/80 p-4 pt-4 animate-lumi-reveal">
			<div className={cn(headClassNames, "justify-between px-1")}>
				<div className="flex gap-2 items-center">
					<NotepadTextIcon className="size-2" />
					<span className="text-foreground font-medium">
						{isStreaming ? "Putting together the plan…" : "Here's the plan"}
					</span>
				</div>
				{!isStreaming && <CopyButton textToCopy={text || ""} />}
			</div>
			<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
				<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
					<div className="wrap-anywhere [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} showCursor={isStreaming} />
					</div>
				</div>
			</div>
			{!isStreaming && auditMetadata && (
				<details className="mt-2 rounded-sm border border-description/20 p-2 text-[10px]">
					<summary>Internal diagnostics</summary>
					<AuditReportPanel auditMetadata={auditMetadata} variant="neutral" />
				</details>
			)}
			{!isStreaming && <p className="text-description/70 text-[11px] px-1 pt-2 pb-0.5">I'll keep going from here.</p>}
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
