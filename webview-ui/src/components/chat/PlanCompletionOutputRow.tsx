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
}

/**
 * Styled completion output for Plan Mode responses.
 * Uses grayscale colors to distinguish from Act Mode's green success theme.
 */
const PlanCompletionOutputRow = memo(({ text, headClassNames, auditMetadata }: PlanCompletionOutputProps) => {
	return (
		<div className="rounded-lg border border-description/40 overflow-visible bg-code/80 p-4 pt-4 animate-mira-reveal">
			<div className={cn(headClassNames, "justify-between px-1")}>
				<div className="flex gap-2 items-center">
					<NotepadTextIcon className="size-2" />
					<span className="text-foreground font-medium">Here's the plan</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>
			<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
				<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
					<div className="wrap-anywhere [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} />
					</div>
				</div>
			</div>
			{auditMetadata && <AuditReportPanel auditMetadata={auditMetadata} variant="neutral" />}
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
