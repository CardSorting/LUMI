export type ChatNavItemId = "newChat" | "history" | "tools" | "account" | "settings"

export interface ChatNavItem {
	id: ChatNavItemId
	label: string
	shortLabel: string
	tooltip: string
	icon: string
	/** Pinned in the compact toolbar (narrow sidebar). */
	showInToolbar: boolean
}

/** Shared navigation — plain labels; all destinations are toolbar icon buttons. */
export const CHAT_NAV_ITEMS: ChatNavItem[] = [
	{
		id: "newChat",
		label: "New chat",
		shortLabel: "New",
		tooltip: "Start New Chat (Alt+Shift+1 or Alt+Shift+N)",
		icon: "PlusIcon",
		showInToolbar: true,
	},
	{
		id: "history",
		label: "Past chats",
		shortLabel: "History",
		tooltip: "Past Chats & History (Alt+Shift+2 or Alt+Shift+H)",
		icon: "HistoryIcon",
		showInToolbar: true,
	},
	{
		id: "tools",
		label: "Connected tools",
		shortLabel: "Tools",
		tooltip: "Connected Tools (MCP) (Alt+Shift+3 or Alt+Shift+T)",
		icon: "server",
		showInToolbar: true,
	},
	{
		id: "account",
		label: "Account",
		shortLabel: "Account",
		tooltip: "Account & Usage (Alt+Shift+4 or Alt+Shift+A)",
		icon: "UserCircleIcon",
		showInToolbar: true,
	},
	{
		id: "settings",
		label: "Preferences",
		shortLabel: "Settings",
		tooltip: "Preferences & Settings (Alt+Shift+5 or Alt+Shift+S)",
		icon: "SettingsIcon",
		showInToolbar: true,
	},
]

export const CHAT_NAV_BY_ID = Object.fromEntries(CHAT_NAV_ITEMS.map((item) => [item.id, item])) as Record<
	ChatNavItemId,
	ChatNavItem
>

export const CHAT_TOOLBAR_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.showInToolbar && item.id !== "newChat")
