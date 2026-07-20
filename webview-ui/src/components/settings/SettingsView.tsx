import type { ExtensionMessage } from "@shared/ExtensionMessage"
import { KeyValuePair } from "@shared/proto/dietcode/common"
import { ResetStateRequest } from "@shared/proto/dietcode/state"
import { UserOrganization } from "@shared/proto/index.dietcode"
import {
	CheckCheck,
	FlaskConical,
	HardDriveDownload,
	Info,
	type LucideIcon,
	Search,
	SlidersHorizontal,
	Sparkles,
	SquareMousePointer,
	SquareTerminal,
	Wrench,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { useDietCodeAuth } from "@/context/DietCodeAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDensity } from "@/hooks/useDensity"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import { isAdminOrOwner } from "../account/helpers"
import { Tab, TabContent, TabList, TabTrigger } from "../common/Tab"
import SectionHeader from "./SectionHeader"
import AboutSection from "./sections/AboutSection"
import ApiConfigurationSection from "./sections/ApiConfigurationSection"
import BrowserSettingsSection from "./sections/BrowserSettingsSection"
import DebugSection from "./sections/DebugSection"
import EmbeddingConfigurationSection from "./sections/EmbeddingConfigurationSection"
import FeatureSettingsSection from "./sections/FeatureSettingsSection"
import GeneralSettingsSection from "./sections/GeneralSettingsSection"
import { RemoteConfigSection } from "./sections/RemoteConfigSection"
import SkillsSettingsSection from "./sections/SkillsSettingsSection"
import TerminalSettingsSection from "./sections/TerminalSettingsSection"

const IS_DEV = process.env.IS_DEV

// Tab definitions
type SettingsTabID =
	| "api-config"
	| "embedding"
	| "features"
	| "skills"
	| "browser"
	| "terminal"
	| "general"
	| "about"
	| "debug"
	| "remote-config"
interface SettingsTab {
	id: SettingsTabID
	name: string
	tooltipText: string
	headerText: string
	icon: LucideIcon
	hidden?: (params?: { activeOrganization: UserOrganization | null }) => boolean
}

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "Models",
		tooltipText: "Choose models and API keys",
		headerText: "Models & keys",
		icon: SlidersHorizontal,
	},
	{
		id: "embedding",
		name: "Search",
		tooltipText: "Optional code search settings",
		headerText: "Code search",
		icon: HardDriveDownload,
	},
	{
		id: "features",
		name: "Preferences",
		tooltipText: "How LUMI behaves",
		headerText: "Preferences",
		icon: CheckCheck,
	},
	{
		id: "skills",
		name: "Skills",
		tooltipText: "Manage LUMI skills",
		headerText: "Skills",
		icon: Sparkles,
	},
	{
		id: "browser",
		name: "Browser",
		tooltipText: "Browser Settings",
		headerText: "Browser Settings",
		icon: SquareMousePointer,
	},
	{
		id: "terminal",
		name: "Terminal",
		tooltipText: "Terminal Settings",
		headerText: "Terminal Settings",
		icon: SquareTerminal,
	},
	{
		id: "general",
		name: "General",
		tooltipText: "Language and privacy",
		headerText: "General",
		icon: Wrench,
	},
	{
		id: "remote-config",
		name: "Remote Config",
		tooltipText: "Remotely configured fields",
		headerText: "Remote Config",
		icon: HardDriveDownload,
		hidden: ({ activeOrganization } = { activeOrganization: null }) =>
			!activeOrganization || !isAdminOrOwner(activeOrganization),
	},
	{
		id: "about",
		name: "About",
		tooltipText: "About LUMI",
		headerText: "About",
		icon: Info,
	},
	// Only show in dev mode
	{
		id: "debug",
		name: "Debug",
		tooltipText: "Debug Tools",
		headerText: "Debug",
		icon: FlaskConical,
		hidden: () => !IS_DEV,
	},
]

const TAB_KEYWORDS: Record<SettingsTabID, string[]> = {
	"api-config": ["models", "keys", "api key", "provider", "ai", "llm", "tokens"],
	embedding: ["search", "indexing", "embeddings", "rag", "code search", "vector"],
	features: ["preferences", "behavior", "subagents", "think together", "tool calls", "plan", "auto-compact", "parallel"],
	skills: ["skills", "mcp", "tools", "plugins", "marketplace"],
	browser: ["browser", "chrome", "viewport", "screenshot", "web"],
	terminal: ["terminal", "shell", "bash", "zsh", "timeout", "reuse", "output", "lockout"],
	general: ["general", "language", "privacy", "telemetry", "analytics", "reports"],
	"remote-config": ["remote", "config", "organization", "admin"],
	about: ["about", "version", "community", "discord", "github", "support"],
	debug: ["debug", "reset", "state", "test", "developer"],
}

const AI_SEARCH_TABS: string[] = ["api-config", "embedding"]
const BEHAVIOR_TABS: string[] = ["features", "skills"]
const INTEGRATION_TABS: string[] = ["browser", "terminal"]
const GENERAL_TABS: string[] = ["general", "about"]
const ADVANCED_TABS: string[] = ["remote-config", "debug"]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

// Helper to render section header - moved outside component for better performance
const renderSectionHeader = (tabId: string) => {
	const tab = SETTINGS_TABS.find((t) => t.id === tabId)
	if (!tab) {
		return null
	}

	return (
		<SectionHeader>
			<div className="flex items-center gap-2">
				<tab.icon className="w-4" />
				<div>{tab.headerText}</div>
			</div>
		</SectionHeader>
	)
}

const SettingsView = ({ targetSection }: SettingsViewProps) => {
	// Memoize to avoid recreation
	// biome-ignore lint/suspicious/noExplicitAny: Components in map take different props
	const TAB_CONTENT_MAP: Record<SettingsTabID, React.ComponentType<any>> = useMemo(
		() => ({
			"api-config": ApiConfigurationSection,
			embedding: EmbeddingConfigurationSection,
			general: GeneralSettingsSection,
			features: FeatureSettingsSection,
			skills: SkillsSettingsSection,
			browser: BrowserSettingsSection,
			terminal: TerminalSettingsSection,
			"remote-config": RemoteConfigSection,
			about: AboutSection,
			debug: DebugSection,
		}),
		[],
	) // Empty deps - these imports never change

	const { version, settingsInitialModelTab } = useExtensionState()
	const { activeOrganization } = useDietCodeAuth()
	const { width } = useDensity()
	const useHorizontalNavigation = width < 340

	const [activeTab, setActiveTab] = useState<SettingsTabID>(() =>
		SETTINGS_TABS.some((tab) => tab.id === targetSection) ? (targetSection as SettingsTabID) : SETTINGS_TABS[0].id,
	)
	const [searchQuery, setSearchQuery] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const isInputActive =
				document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
			if (!isInputActive && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "f"))) {
				e.preventDefault()
				searchInputRef.current?.focus()
				searchInputRef.current?.select()
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

	const visibleTabs = useMemo(() => {
		const filtered = SETTINGS_TABS.filter((tab) => !tab.hidden?.({ activeOrganization }))
		if (!searchQuery.trim()) {
			return filtered
		}
		const query = searchQuery.toLowerCase().trim()
		return filtered.filter((tab) => {
			const nameMatch = tab.name.toLowerCase().includes(query)
			const tooltipMatch = tab.tooltipText.toLowerCase().includes(query)
			const headerMatch = tab.headerText.toLowerCase().includes(query)
			const keywords = TAB_KEYWORDS[tab.id] || []
			const keywordMatch = keywords.some((kw) => kw.includes(query))
			return nameMatch || tooltipMatch || headerMatch || keywordMatch
		})
	}, [activeOrganization, searchQuery])

	// Auto-switch active tab to the first match if the current active tab is filtered out
	useEffect(() => {
		if (searchQuery.trim() && visibleTabs.length > 0 && !visibleTabs.some((tab) => tab.id === activeTab)) {
			setActiveTab(visibleTabs[0].id)
		}
	}, [searchQuery, visibleTabs, activeTab])

	// Optimized message handler with early returns
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type !== "grpc_response") {
			return
		}

		const grpcMessage = message.grpc_response?.message as KeyValuePair | undefined
		if (grpcMessage?.key !== "scrollToSettings") {
			return
		}

		const tabId = grpcMessage.value
		if (!tabId) {
			return
		}

		// Check if valid tab ID
		if (SETTINGS_TABS.some((tab) => tab.id === tabId)) {
			setActiveTab(tabId as SettingsTabID)
			return
		}

		// Fallback to element scrolling
		requestAnimationFrame(() => {
			const element = document.getElementById(tabId)
			if (!element) {
				return
			}

			element.scrollIntoView({ behavior: "smooth" })
			element.style.transition = "background-color 0.5s ease"
			element.style.backgroundColor = "var(--vscode-textPreformat-background)"

			setTimeout(() => {
				element.style.backgroundColor = "transparent"
			}, 1200)
		})
	}, [])

	useEvent("message", handleMessage)

	// Memoized reset state handler
	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	// Update active tab when targetSection changes
	useEffect(() => {
		if (targetSection && visibleTabs.some((tab) => tab.id === targetSection)) {
			setActiveTab(targetSection as SettingsTabID)
		}
	}, [targetSection, visibleTabs])

	useEffect(() => {
		if (!visibleTabs.some((tab) => tab.id === activeTab)) {
			setActiveTab(visibleTabs[0]?.id ?? SETTINGS_TABS[0].id)
		}
	}, [activeTab, visibleTabs])

	// Memoized tab item renderer
	const renderTabItem = useCallback(
		(tab: (typeof SETTINGS_TABS)[0]) => {
			const isActive = activeTab === tab.id
			return (
				<TabTrigger
					aria-label={tab.name}
					className={cn(
						"flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-transparent px-3 text-foreground/70 hover:bg-list-hover hover:text-foreground",
						useHorizontalNavigation
							? "min-h-10 w-auto justify-start border-b-2"
							: "min-h-[30px] h-[30px] w-full justify-start border-l-2 rounded-r-md px-4 transition-colors",
						isActive &&
							(useHorizontalNavigation
								? "border-b-foreground bg-selection-inactive text-foreground"
								: "border-l-foreground bg-selection-inactive text-foreground"),
					)}
					data-testid={`tab-${tab.id}`}
					key={tab.id}
					title={tab.tooltipText}
					value={tab.id}>
					<tab.icon aria-hidden className="h-4 w-4 shrink-0 opacity-80" />
					<span className="truncate text-left text-xs font-medium">{tab.name}</span>
				</TabTrigger>
			)
		},
		[activeTab, useHorizontalNavigation],
	)

	// Memoized active content component
	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab as keyof typeof TAB_CONTENT_MAP]
		if (!Component) {
			return null
		}

		// Special props for specific components
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic props mapped to specific components
		const props: any = { renderSectionHeader }
		if (activeTab === "debug") {
			props.onResetState = handleResetState
		} else if (activeTab === "about") {
			props.version = version
		} else if (activeTab === "api-config") {
			props.initialModelTab = settingsInitialModelTab
		}

		return <Component {...props} />
	}, [activeTab, handleResetState, settingsInitialModelTab, version, TAB_CONTENT_MAP])

	return (
		<Tab>
			<div className={cn("flex flex-1 overflow-hidden", useHorizontalNavigation && "flex-col")}>
				{useHorizontalNavigation ? (
					<TabList
						aria-label="Settings sections"
						aria-orientation="horizontal"
						className="flex shrink-0 lumi-scroll-chips w-full flex-row overflow-x-auto border-b border-border/30"
						onValueChange={(value) => setActiveTab(value as SettingsTabID)}
						value={activeTab}>
						{visibleTabs.map(renderTabItem)}
					</TabList>
				) : (
					<div className="flex shrink-0 w-44 flex-col border-r border-border/30 overflow-hidden bg-(--vscode-sideBar-background)">
						{/* Search Box */}
						<div className="p-2 border-b border-border/10">
							<div className="relative flex items-center">
								<Search className="absolute left-2.5 h-3.5 w-3.5 text-(--vscode-input-placeholderForeground) opacity-65" />
								<input
									className="w-full pl-8 pr-12 py-1 text-xs rounded border border-border/40 bg-(--vscode-input-background) text-(--vscode-input-foreground) placeholder-(--vscode-input-placeholderForeground) focus:outline-none focus:border-(--vscode-focusBorder) transition-colors"
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search settings..."
									ref={searchInputRef}
									type="text"
									value={searchQuery}
								/>
								{!searchQuery ? (
									<span className="absolute right-2 text-[9px] font-mono px-1 py-0.5 rounded bg-border/20 text-(--vscode-input-placeholderForeground) select-none pointer-events-none opacity-70">
										{typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
											? "⌘F"
											: "Ctrl+F"}
									</span>
								) : (
									<button
										className="absolute right-2 text-xs text-(--vscode-input-placeholderForeground) hover:text-(--vscode-input-foreground) focus:outline-none"
										onClick={() => setSearchQuery("")}>
										✕
									</button>
								)}
							</div>
						</div>

						<TabList
							aria-label="Settings sections"
							aria-orientation="vertical"
							className="flex-1 overflow-y-auto flex flex-col gap-4 py-3"
							onValueChange={(value) => setActiveTab(value as SettingsTabID)}
							value={activeTab}>
							{visibleTabs.length === 0 ? (
								<div className="text-xs text-(--vscode-descriptionForeground) px-3 py-4 text-center select-none">
									No settings found
								</div>
							) : (
								<>
									{visibleTabs.some((t) => AI_SEARCH_TABS.includes(t.id)) && (
										<div>
											<div className="text-[9px] font-bold tracking-wider text-(--vscode-descriptionForeground) uppercase px-3 mb-1 select-none opacity-60">
												AI Assistant
											</div>
											<div className="flex flex-col gap-0.5">
												{visibleTabs.filter((t) => AI_SEARCH_TABS.includes(t.id)).map(renderTabItem)}
											</div>
										</div>
									)}
									{visibleTabs.some((t) => BEHAVIOR_TABS.includes(t.id)) && (
										<div>
											<div className="text-[9px] font-bold tracking-wider text-(--vscode-descriptionForeground) uppercase px-3 mb-1 select-none opacity-60">
												Behavior
											</div>
											<div className="flex flex-col gap-0.5">
												{visibleTabs.filter((t) => BEHAVIOR_TABS.includes(t.id)).map(renderTabItem)}
											</div>
										</div>
									)}
									{visibleTabs.some((t) => INTEGRATION_TABS.includes(t.id)) && (
										<div>
											<div className="text-[9px] font-bold tracking-wider text-(--vscode-descriptionForeground) uppercase px-3 mb-1 select-none opacity-60">
												System Tools
											</div>
											<div className="flex flex-col gap-0.5">
												{visibleTabs.filter((t) => INTEGRATION_TABS.includes(t.id)).map(renderTabItem)}
											</div>
										</div>
									)}
									{visibleTabs.some((t) => GENERAL_TABS.includes(t.id)) && (
										<div>
											<div className="text-[9px] font-bold tracking-wider text-(--vscode-descriptionForeground) uppercase px-3 mb-1 select-none opacity-60">
												General
											</div>
											<div className="flex flex-col gap-0.5">
												{visibleTabs.filter((t) => GENERAL_TABS.includes(t.id)).map(renderTabItem)}
											</div>
										</div>
									)}
									{visibleTabs.some((t) => ADVANCED_TABS.includes(t.id)) && (
										<div>
											<div className="text-[9px] font-bold tracking-wider text-(--vscode-descriptionForeground) uppercase px-3 mb-1 select-none opacity-60">
												Advanced
											</div>
											<div className="flex flex-col gap-0.5">
												{visibleTabs.filter((t) => ADVANCED_TABS.includes(t.id)).map(renderTabItem)}
											</div>
										</div>
									)}
								</>
							)}
						</TabList>
					</div>
				)}

				<TabContent
					aria-labelledby={`lumi-tab-${activeTab}`}
					className="flex-1 overflow-auto outline-none"
					id={`lumi-tabpanel-${activeTab}`}
					role="tabpanel"
					tabIndex={0}>
					<div className="animate-in fade-in-50 duration-200" key={activeTab}>
						{ActiveContent}
					</div>
				</TabContent>
			</div>
		</Tab>
	)
}

export default SettingsView
