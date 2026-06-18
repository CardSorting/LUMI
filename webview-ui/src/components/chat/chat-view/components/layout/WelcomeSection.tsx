import HistoryPreview from "@/components/history/HistoryPreview"
import HomeHeader from "@/components/welcome/HomeHeader"
import { WelcomeSectionProps } from "../../types/chatTypes"

/**
 * Welcome scroll area — suggestions live in the footer above input (ChatGPT-style).
 */
export const WelcomeSection: React.FC<WelcomeSectionProps> = ({ showHistoryView, taskHistory }) => {
	const hasRecentChats = taskHistory.some(
		(item): item is { ts: number; task: string } =>
			typeof item === "object" && item !== null && "ts" in item && "task" in item && Boolean(item.ts && item.task),
	)

	return (
		<div className="flex flex-col flex-1 w-full min-h-0 overflow-hidden">
			<div className="flex-1 overflow-y-auto flex flex-col min-h-0 justify-center">
				<HomeHeader />
				{hasRecentChats && <HistoryPreview showHistoryView={showHistoryView} />}
			</div>
		</div>
	)
}
