export type ChatNavItemId = "newChat" | "chat" | "history" | "tools" | "settings" | "worktrees"

export interface ChatNavItem {
	id: ChatNavItemId
	label: string
	shortLabel: string
	description: string
	tooltip: string
	icon: string
	/** Kept directly visible in the compact app bar. */
	showInToolbar: boolean
	shortcutMac?: string
	shortcutWin?: string
}

/** Shared navigation copy for the app bar, overflow menu, shortcuts, and tests. */
export const CHAT_NAV_ITEMS: ChatNavItem[] = [
	{
		id: "newChat",
		label: "New chat",
		shortLabel: "New",
		description: "Start a fresh conversation",
		tooltip: "New chat (Alt+Shift+1 or Alt+Shift+N)",
		icon: "PlusIcon",
		showInToolbar: true,
		shortcutMac: "⌥⇧N",
		shortcutWin: "Alt+Shift+N",
	},
	{
		id: "chat",
		label: "Active chat",
		shortLabel: "Chat",
		description: "Return to the current conversation",
		tooltip: "Active chat (Alt+Shift+C)",
		icon: "feedback",
		showInToolbar: false,
		shortcutMac: "⌥⇧C",
		shortcutWin: "Alt+Shift+C",
	},
	{
		id: "history",
		label: "Chat history",
		shortLabel: "History",
		description: "Browse and open past conversations",
		tooltip: "Chat history (Alt+Shift+2 or Alt+Shift+H)",
		icon: "HistoryIcon",
		showInToolbar: true,
		shortcutMac: "⌥⇧H",
		shortcutWin: "Alt+Shift+H",
	},
	{
		id: "tools",
		label: "Plugins & tools",
		shortLabel: "Tools",
		description: "Connect external APIs, databases, and integrations",
		tooltip: "Plugins & tools (Alt+Shift+3 or Alt+Shift+T)",
		icon: "server",
		showInToolbar: false,
		shortcutMac: "⌥⇧T",
		shortcutWin: "Alt+Shift+T",
	},
	{
		id: "worktrees",
		label: "Branch workspaces",
		shortLabel: "Workspaces",
		description: "Work on different code branches in parallel",
		tooltip: "Branch workspaces (Alt+Shift+6 or Alt+Shift+W)",
		icon: "GitBranch",
		showInToolbar: false,
		shortcutMac: "⌥⇧W",
		shortcutWin: "Alt+Shift+W",
	},
	{
		id: "settings",
		label: "Settings",
		shortLabel: "Settings",
		description: "Configure models, rules, and preferences",
		tooltip: "Settings (Alt+Shift+5 or Alt+Shift+S)",
		icon: "SettingsIcon",
		showInToolbar: false,
		shortcutMac: "⌥⇧S",
		shortcutWin: "Alt+Shift+S",
	},
]

export const CHAT_NAV_BY_ID = Object.fromEntries(CHAT_NAV_ITEMS.map((item) => [item.id, item])) as Record<
	ChatNavItemId,
	ChatNavItem
>

export const CHAT_TOOLBAR_ITEMS = CHAT_NAV_ITEMS.filter((item) => item.showInToolbar && item.id !== "newChat")

export const CHAT_MENU_ITEMS = CHAT_NAV_ITEMS
