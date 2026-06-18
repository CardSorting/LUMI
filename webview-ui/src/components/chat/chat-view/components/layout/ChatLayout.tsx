import type React from "react"
import { cn } from "@/lib/utils"

interface ChatLayoutProps {
	isHidden: boolean
	isNightDesk?: boolean
	serenityLevel?: 0 | 1 | 2 | 3
	children: React.ReactNode
}

/**
 * Main layout container for the chat view — grid: messages (1fr) + footer (auto).
 */
export const ChatLayout: React.FC<ChatLayoutProps> = ({ isHidden, isNightDesk = false, serenityLevel = 0, children }) => {
	return (
		<div
			className={cn(
				"lumi-chat-readable lumi-serenity-fade w-full h-full relative overflow-hidden p-0 m-0",
				isHidden ? "hidden" : "grid grid-rows-[1fr_auto]",
			)}
			data-night-desk={isNightDesk ? "true" : undefined}
			data-serenity-level={serenityLevel > 0 ? String(serenityLevel) : undefined}>
			<div className="flex flex-col overflow-hidden row-start-1 flex-1 min-h-0">{children}</div>
		</div>
	)
}
