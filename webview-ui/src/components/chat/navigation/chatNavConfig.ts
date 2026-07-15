export type ChatNavItemId = "newChat" | "chat" | "history" | "tools" | "account" | "settings"

export interface ChatNavItem {
	id: ChatNavItemId
	label: string
	shortLabel: string
	description: string
	tooltip: string
	icon: string
	/** Kept directly visible in the compact app bar. */
	showInToolbar: boolean
}

/** Shared navigation copy for the app bar, overflow menu, shortcuts, and tests. */
export const CHAT_NAV_ITEMS: ChatNavItem[] = [
	{
		id: "newChat",
		label: "New chat",
		shortLabel: "New",
		description: "Start a blank conversation",
		tooltip: "New chat (Alt+Shift+1 or Alt+Shift+N)",
		icon: "PlusIcon",
		showInToolbar: true,
	},
	{
		id: "chat",
		label: "Current chat",
		shortLabel: "Chat",
		description: "Return to the active conversation",
		tooltip: "Current chat (Alt+Shift+C)",
		icon: "feedback",
		showInToolbar: false,
	},
	{
		id: "history",
		label: "Past chats",
		shortLabel: "History",
		description: "Open a previous conversation",
		tooltip: "Past chats (Alt+Shift+2 or Alt+Shift+H)",
		icon: "HistoryIcon",
		showInToolbar: true,
	},

	{
		id: "settings",
		label: "Settings",
		shortLabel: "Settings",
		description: "Models, preferences, and privacy",
		tooltip: "Settings (Alt+Shift+5 or Alt+Shift+S)",
		icon: "SettingsIcon",
		showInToolbar: false,
	},
]

export const CHAT_NAV_BY_ID = Object.fromEntries(CHAT_NAV_ITEMS.map((item) => [item.id, item])) as Record<
	ChatNavItemId,
	ChatNavItem
>

export const CHAT_TOOLBAR_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.showInToolbar && item.id !== "newChat")

export const CHAT_MENU_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.id !== "newChat")
