import { Box, History, MessageSquare, Settings, User } from "lucide-react"
import React from "react"

interface MobileLayoutProps {
	children: React.ReactNode
	activeTab: "chat" | "history" | "mcp" | "account" | "settings"
	onTabChange: (tab: "chat" | "history" | "mcp" | "account" | "settings") => void
}

const MobileLayout: React.FC<MobileLayoutProps> = ({ children, activeTab, onTabChange }) => {
	const tabs = [
		{ id: "chat", icon: MessageSquare, label: "Chat" },
		{ id: "history", icon: History, label: "History" },
		{ id: "mcp", icon: Box, label: "MCP" },
		{ id: "account", icon: User, label: "Account" },
		{ id: "settings", icon: Settings, label: "Settings" },
	] as const

	return (
		<div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden font-sans">
			{/* Main Content Area */}
			<main className="flex-1 overflow-hidden relative safe-area-top">{children}</main>

			{/* Bottom Navigation Bar */}
			<nav className="flex justify-around items-center h-16 bg-background border-t border-border safe-area-bottom pb-1 sm:pb-0 no-select">
				{tabs.map(({ id, icon: Icon, label }) => (
					<button
						className={`flex flex-col items-center justify-center flex-1 h-full space-y-1 transition-all duration-200 mobile-active-scale ${
							activeTab === id ? "text-primary scale-110" : "text-muted-foreground opacity-70"
						}`}
						key={id}
						onClick={() => onTabChange(id)}
						type="button">
						<Icon size={22} strokeWidth={activeTab === id ? 2.5 : 2} />
						<span
							className={`text-[10px] font-semibold leading-none ${activeTab === id ? "opacity-100" : "opacity-80"}`}>
							{label}
						</span>
					</button>
				))}
			</nav>
		</div>
	)
}

export default MobileLayout
