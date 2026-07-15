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
	SlidersHorizontal,
	Sparkles,
	SquareMousePointer,
	SquareTerminal,
	Wrench,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
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
	const visibleTabs = useMemo(() => SETTINGS_TABS.filter((tab) => !tab.hidden?.({ activeOrganization })), [activeOrganization])

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
							: "min-h-11 w-36 justify-start border-l-2",
						isActive &&
							(useHorizontalNavigation
								? "border-b-foreground bg-selection-inactive text-foreground"
								: "border-l-foreground bg-selection-inactive text-foreground"),
					)}
					data-testid={`tab-${tab.id}`}
					key={tab.id}
					title={tab.tooltipText}
					value={tab.id}>
					<tab.icon aria-hidden className="h-4 w-4 shrink-0" />
					<span className="truncate text-left text-xs">{tab.name}</span>
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
				<TabList
					aria-label="Settings sections"
					aria-orientation={useHorizontalNavigation ? "horizontal" : "vertical"}
					className={cn(
						"flex shrink-0",
						useHorizontalNavigation
							? "lumi-scroll-chips w-full flex-row overflow-x-auto border-b border-border/30"
							: "w-36 flex-col overflow-y-auto border-r border-border/30",
					)}
					onValueChange={(value) => setActiveTab(value as SettingsTabID)}
					value={activeTab}>
					{visibleTabs.map(renderTabItem)}
				</TabList>

				<TabContent
					aria-labelledby={`lumi-tab-${activeTab}`}
					className="flex-1 overflow-auto outline-none"
					id={`lumi-tabpanel-${activeTab}`}
					role="tabpanel"
					tabIndex={0}>
					{ActiveContent}
				</TabContent>
			</div>
		</Tab>
	)
}

export default SettingsView
