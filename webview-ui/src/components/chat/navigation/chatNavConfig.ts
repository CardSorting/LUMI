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
		tooltip: "Start a fresh conversation",
		icon: "PlusIcon",
		showInToolbar: true,
	},
	{
		id: "history",
		label: "Past chats",
		shortLabel: "History",
		tooltip: "Browse past conversations",
		icon: "HistoryIcon",
		showInToolbar: true,
	},
	{
		id: "tools",
		label: "Connected tools",
		shortLabel: "Tools",
		tooltip: "Manage connected tools",
		icon: "server",
		showInToolbar: true,
	},
	{
		id: "account",
		label: "Account",
		shortLabel: "Account",
		tooltip: "Your account and usage",
		icon: "UserCircleIcon",
		showInToolbar: true,
	},
	{
		id: "settings",
		label: "Preferences",
		shortLabel: "Settings",
		tooltip: "Model and preferences",
		icon: "SettingsIcon",
		showInToolbar: true,
	},
]

export const CHAT_NAV_BY_ID = Object.fromEntries(CHAT_NAV_ITEMS.map((item) => [item.id, item])) as Record<
	ChatNavItemId,
	ChatNavItem
>

export const CHAT_TOOLBAR_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.showInToolbar && item.id !== "newChat")
