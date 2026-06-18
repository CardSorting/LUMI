import { StringRequest } from "@shared/proto/dietcode/common"
import { ChevronRight } from "lucide-react"
import { memo } from "react"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()

	const recentItems = taskHistory.filter((item) => item.ts && item.task).slice(0, 2)

	const handleOpenConversation = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	if (recentItems.length === 0) {
		return null
	}

	return (
		<section aria-label="Recent conversations" className="px-3 pb-2">
			<div className="flex items-center justify-between mb-1.5">
				<p className="text-[11px] font-medium text-muted-foreground m-0">Recent chats</p>
				<Button
					aria-label="See all past chats"
					className="h-auto py-0 px-1 text-[11px] text-muted-foreground hover:text-foreground gap-0.5"
					onClick={showHistoryView}
					size="sm"
					variant="ghost">
					All chats
					<ChevronRight aria-hidden className="size-3" />
				</Button>
			</div>

			<ul className="flex flex-col gap-1 m-0 p-0 list-none">
				{recentItems.map((item) => (
					<li key={item.id}>
						<button
							className={cn(
								"w-full text-left px-2.5 py-1.5 rounded-md text-xs",
								"text-foreground truncate",
								"bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_35%,transparent)]",
								"hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_70%,transparent)]",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							)}
							onClick={() => handleOpenConversation(item.id)}
							title={item.task}
							type="button">
							<span className="ph-no-capture">{item.task}</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	)
}

export default memo(HistoryPreview)
