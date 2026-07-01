import { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Int64Request } from "@shared/proto/dietcode/common"
import { CheckIcon } from "lucide-react"
import { memo } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { pickCompletionPresentation } from "@/copy/lumiVoice"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { AuditReportPanel } from "./AuditReportPanel"
import { MarkdownRow } from "./MarkdownRow"

interface CompletionOutputRowProps {
	text: string
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
		showActionRow,
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
		auditMetadata,
	}: CompletionOutputRowProps) => {
		const presentation = pickCompletionPresentation(messageTs)

		return (
			<div>
				<div className="rounded-lg border border-success/10 overflow-visible bg-success/[0.04] p-4 pt-4 animate-lumi-settle">
					<div className={cn(headClassNames, "justify-between px-1 mb-1")}>
						<div className="flex flex-col gap-0.5 min-w-0 flex-1">
							{presentation.showHeader ? (
								<>
									<div className="flex gap-2 items-center">
										<CheckIcon className="size-3 text-success/70 animate-lumi-reveal [animation-duration:0.75s]" />
										{presentation.header && (
											<span className="text-success/80 font-medium">{presentation.header}</span>
										)}
									</div>
									{presentation.closer && (
										<span className="text-success/60 text-xs pl-5">{presentation.closer}</span>
									)}
								</>
							) : (
								<span className="text-success/80 text-xs font-medium">Done</span>
							)}
						</div>
						<CopyButton className="text-success/80 shrink-0" textToCopy={text} />
					</div>
					<div className={cn("w-full relative rounded-b-sm", "border-t-1 border-description/15")}>
						<div className="completion-output-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
							<MarkdownRow markdown={text} />
						</div>
					</div>
					{auditMetadata && (
						<details className="mt-2 rounded-sm border border-description/20 p-2 text-[10px]">
							<summary>Internal diagnostics</summary>
							<AuditReportPanel auditMetadata={auditMetadata} variant="success" />
						</details>
					)}
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
					See what changed
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
						{explainChangesDisabled ? "Explaining…" : "Explain changes"}
					</SuccessButton>
				)}
			</div>
		)
	},
)
