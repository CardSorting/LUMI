import { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Int64Request } from "@shared/proto/dietcode/common"
import { CheckIcon } from "lucide-react"
import { memo } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { AuditReportPanel } from "./AuditReportPanel"
import { QuoteButtonState } from "./chat-types"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	headClassNames?: string
	showActionRow?: boolean
	seeNewChangesDisabled: boolean
	setSeeNewChangesDisabled: (value: boolean) => void
	explainChangesDisabled: boolean
	setExplainChangesDisabled: (value: boolean) => void
	messageTs: number
	auditMetadata?: TaskAuditMetadata
}

export const CompletionOutputRow = memo(
	({
		headClassNames,
		text,
		quoteButtonState,
		showActionRow,
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
		handleQuoteClick,
		auditMetadata,
	}: CompletionOutputRowProps) => {
		return (
			<div>
				<div className="rounded-sm border border-success/20 overflow-visible bg-success/10 p-2 pt-3">
					<div className={cn(headClassNames, "justify-between px-1")}>
						<div className="flex gap-2 items-center">
							<CheckIcon className="size-3 text-success" />
							<span className="text-success font-bold">Task Completed</span>
						</div>
						<CopyButton className="text-success" textToCopy={text} />
					</div>
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="completion-output-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
							<MarkdownRow markdown={text} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
					</div>
					{auditMetadata && <AuditReportPanel auditMetadata={auditMetadata} variant="success" />}
				</div>
				{showActionRow && (
					<CompletionOutputActionRow
						explainChangesDisabled={explainChangesDisabled}
						messageTs={messageTs}
						seeNewChangesDisabled={seeNewChangesDisabled}
						setExplainChangesDisabled={setExplainChangesDisabled}
						setSeeNewChangesDisabled={setSeeNewChangesDisabled}
					/>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"

const CompletionOutputActionRow = memo(
	({
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
	}: {
		seeNewChangesDisabled: boolean
		setSeeNewChangesDisabled: (value: boolean) => void
		explainChangesDisabled: boolean
		setExplainChangesDisabled: (value: boolean) => void
		messageTs: number
	}) => {
		return (
			<div className="pt-2.5 flex flex-col gap-2">
				<SuccessButton
					className={cn("w-full", seeNewChangesDisabled ? "cursor-wait" : "cursor-pointer")}
					disabled={seeNewChangesDisabled}
					onClick={() => {
						setSeeNewChangesDisabled(true)
						TaskServiceClient.taskCompletionViewChanges(Int64Request.create({ value: messageTs })).catch((err) =>
							console.error("Failed to show task completion view changes:", err),
						)
					}}>
					<VscIcon className="mr-1.5" name="new-file" />
					View Changes
				</SuccessButton>
				{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
					<SuccessButton
						className={cn("w-full", explainChangesDisabled ? "cursor-wait" : "cursor-pointer")}
						disabled={explainChangesDisabled}
						onClick={() => {
							setExplainChangesDisabled(true)
							TaskServiceClient.explainChanges({ metadata: {}, messageTs }).catch((err) => {
								console.error("Failed to explain changes:", err)
								setExplainChangesDisabled(false)
							})
						}}>
						<VscIcon className="mr-1.5" name="comment-discussion" />
						{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
					</SuccessButton>
				)}
			</div>
		)
	},
)
