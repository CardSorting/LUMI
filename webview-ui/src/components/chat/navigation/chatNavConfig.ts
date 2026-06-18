export type ChatNavItemId = "newChat" | "history" | "tools" | "account" | "settings"

export interface ChatNavItem {
	id: ChatNavItemId
	label: string
	shortLabel: string
	tooltip: string
	icon: string
	/** Pinned in the compact toolbar (narrow sidebar). */
	showInToolbar: boolean
	/** Grouped in the ⋮ overflow menu to save horizontal space. */
	showInOverflowMenu: boolean
}

/** Shared navigation — plain labels; overflow keeps the toolbar uncluttered in narrow panels. */
export const CHAT_NAV_ITEMS: ChatNavItem[] = [
	{
		id: "newChat",
		label: "New chat",
		shortLabel: "New",
		tooltip: "Start a fresh conversation",
		icon: "PlusIcon",
		showInToolbar: true,
		showInOverflowMenu: false,
	},
	{
		id: "history",
		label: "Past chats",
		shortLabel: "History",
		tooltip: "Browse past conversations",
		icon: "HistoryIcon",
		showInToolbar: true,
		showInOverflowMenu: false,
	},
	{
		id: "tools",
		label: "Connected tools",
		shortLabel: "Tools",
		tooltip: "Manage connected tools",
		icon: "server",
		showInToolbar: false,
		showInOverflowMenu: true,
	},
	{
		id: "account",
		label: "Account",
		shortLabel: "Account",
		tooltip: "Your account and usage",
		icon: "UserCircleIcon",
		showInToolbar: false,
		showInOverflowMenu: true,
	},
	{
		id: "settings",
		label: "Preferences",
		shortLabel: "Settings",
		tooltip: "Model and preferences",
		icon: "SettingsIcon",
		showInToolbar: false,
		showInOverflowMenu: true,
	},
]

export const CHAT_NAV_BY_ID = Object.fromEntries(CHAT_NAV_ITEMS.map((item) => [item.id, item])) as Record<
	ChatNavItemId,
	ChatNavItem
>

export const CHAT_TOOLBAR_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.showInToolbar && item.id !== "newChat")
export const CHAT_OVERFLOW_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.showInOverflowMenu)
