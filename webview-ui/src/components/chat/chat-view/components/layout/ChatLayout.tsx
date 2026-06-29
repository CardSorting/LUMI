import type React from "react"
import { DensityProvider, useDensityContext } from "@/context/DensityContext"
import { cn } from "@/lib/utils"

interface ChatLayoutProps {
	isHidden: boolean
	isNightDesk?: boolean
	serenityLevel?: 0 | 1 | 2 | 3
	children: React.ReactNode
}

/**
 * Inner layout shell — reads density context and applies data attributes.
 */
const ChatLayoutInner: React.FC<ChatLayoutProps> = ({ isHidden, isNightDesk = false, serenityLevel = 0, children }) => {
	const { density, isShortHeight } = useDensityContext()

	return (
		<div
			className={cn(
				"lumi-chat-readable lumi-serenity-fade w-full h-full relative overflow-hidden p-0 m-0",
				isHidden ? "hidden" : "grid grid-rows-[1fr_auto]",
			)}
			data-density={density}
			data-night-desk={isNightDesk ? "true" : undefined}
			data-serenity-level={serenityLevel > 0 ? String(serenityLevel) : undefined}
			data-short-height={isShortHeight ? "true" : undefined}>
			<div className="flex flex-col overflow-hidden row-start-1 flex-1 min-h-0">{children}</div>
		</div>
	)
}

/**
 * Main layout container for the chat view — grid: messages (1fr) + footer (auto).
 * Wraps in DensityProvider so all descendants can read sidebar density state.
 */
export const ChatLayout: React.FC<ChatLayoutProps> = (props) => {
	return (
		<DensityProvider>
			<ChatLayoutInner {...props} />
		</DensityProvider>
	)
}
