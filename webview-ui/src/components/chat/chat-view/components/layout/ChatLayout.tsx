import type React from "react"
import styled from "styled-components"

interface ChatLayoutProps {
	isHidden: boolean
	isNightDesk?: boolean
	serenityLevel?: 0 | 1 | 2 | 3
	children: React.ReactNode
}

/**
 * Main layout container for the chat view
 * Provides the fixed positioning and flex layout structure
 */
export const ChatLayout: React.FC<ChatLayoutProps> = ({ isHidden, isNightDesk = false, serenityLevel = 0, children }) => {
	return (
		<ChatLayoutContainer
			className="mira-chat-readable mira-serenity-fade"
			data-night-desk={isNightDesk ? "true" : undefined}
			data-serenity-level={serenityLevel > 0 ? String(serenityLevel) : undefined}
			isHidden={isHidden}>
			<MainContent>{children}</MainContent>
		</ChatLayoutContainer>
	)
}

const ChatLayoutContainer = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isHidden"].includes(prop),
})<{ isHidden: boolean }>`
	display: ${(props) => (props.isHidden ? "none" : "grid")};
	grid-template-rows: 1fr auto;
	overflow: hidden;
	padding: 0;
	margin: 0;
	width: 100%;
	height: 100%;
	position: relative;
`

const MainContent = styled.div`
	display: flex;
	flex-direction: column;
	overflow: hidden;
	grid-row: 1;
	flex: 1;
	min-height: 0;
`

// Note: serenity fade applied via className on wrapper in ChatLayout if needed
