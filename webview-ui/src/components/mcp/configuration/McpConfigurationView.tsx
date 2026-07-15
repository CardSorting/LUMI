import { McpViewTab } from "@shared/mcp"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { McpServers } from "@shared/proto/dietcode/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import { Tab, TabContent, TabList, TabTrigger } from "../../common/Tab"
import AddRemoteServerForm from "./tabs/add-server/AddRemoteServerForm"
import ConfigureServersView from "./tabs/installed/ConfigureServersView"
import McpMarketplaceView from "./tabs/marketplace/McpMarketplaceView"

type McpViewProps = {
	onDone: () => void
	initialTab?: McpViewTab
}

const McpConfigurationView = ({ initialTab }: McpViewProps) => {
	const { remoteConfigSettings, setMcpServers } = useExtensionState()
	// Show marketplace by default unless remote config explicitly disables it
	const showMarketplace = remoteConfigSettings?.mcpMarketplaceEnabled !== false
	const showRemoteServers = remoteConfigSettings?.blockPersonalRemoteMCPServers !== true
	const [activeTab, setActiveTab] = useState<McpViewTab>(initialTab || (showMarketplace ? "marketplace" : "configure"))

	const handleTabChange = (tab: McpViewTab) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		if (!showMarketplace && activeTab === "marketplace") {
			// If marketplace is disabled by remote config and we're on marketplace tab, switch to configure
			setActiveTab("configure")
		}
		if (!showRemoteServers && activeTab === "addRemote") {
			setActiveTab("configure")
		}
	}, [showMarketplace, showRemoteServers, activeTab])

	// Get setter for MCP marketplace catalog from context
	const { setMcpMarketplaceCatalog } = useExtensionState()

	useEffect(() => {
		if (showMarketplace) {
			McpServiceClient.refreshMcpMarketplace(EmptyRequest.create({}))
				.then((response) => {
					setMcpMarketplaceCatalog(response)
				})
				.catch((error) => {
					console.error("Error refreshing MCP marketplace:", error)
				})

			McpServiceClient.getLatestMcpServers(EmptyRequest.create({}))
				.then((response: McpServers) => {
					if (response.mcpServers) {
						const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
						setMcpServers(mcpServers)
					}
				})
				.catch((error) => {
					console.error("Failed to fetch MCP servers:", error)
				})
		}
	}, [showMarketplace, setMcpMarketplaceCatalog, setMcpServers])

	return (
		<Tab>
			<TabList
				aria-label="Tool sections"
				className="lumi-scroll-chips shrink-0 gap-0.5 overflow-x-auto border-b border-border-panel px-2"
				onValueChange={(value) => handleTabChange(value as McpViewTab)}
				value={activeTab}>
				{showMarketplace && (
					<TabTrigger
						aria-label="Browse tools"
						className="min-h-9 shrink-0 border-b-2 border-transparent px-3 text-xs text-description hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground"
						title="Browse available tools"
						value="marketplace">
						Browse
					</TabTrigger>
				)}
				{showRemoteServers && (
					<TabTrigger
						aria-label="Add a tool"
						className="min-h-9 shrink-0 border-b-2 border-transparent px-3 text-xs text-description hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground"
						title="Connect a remote tool"
						value="addRemote">
						Add
					</TabTrigger>
				)}
				<TabTrigger
					aria-label="Your tools"
					className="min-h-9 shrink-0 border-b-2 border-transparent px-3 text-xs text-description hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground"
					title="Manage connected tools"
					value="configure">
					Your tools
				</TabTrigger>
			</TabList>

			<TabContent
				aria-labelledby={`lumi-tab-${activeTab}`}
				className="w-full outline-none"
				id={`lumi-tabpanel-${activeTab}`}
				role="tabpanel"
				tabIndex={0}>
				{showMarketplace && activeTab === "marketplace" && <McpMarketplaceView />}
				{showRemoteServers && activeTab === "addRemote" && (
					<AddRemoteServerForm onServerAdded={() => handleTabChange("configure")} />
				)}
				{activeTab === "configure" && <ConfigureServersView />}
			</TabContent>
		</Tab>
	)
}

const StyledTabButton = styled.button.withConfig({
	shouldForwardProp: (prop) => !["isActive"].includes(prop),
})<{ isActive: boolean; disabled?: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;
	opacity: ${(props) => (props.disabled ? 0.6 : 1)};
	pointer-events: ${(props) => (props.disabled ? "none" : "auto")};
	min-height: 36px;

	&:hover {
		color: ${(props) => (props.disabled ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)")};
	}

	&:focus-visible {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}
`

export const TabButton = ({
	children,
	isActive,
	onClick,
	disabled,
	style,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
	disabled?: boolean
	style?: React.CSSProperties
}) => (
	<StyledTabButton
		aria-pressed={isActive}
		disabled={disabled}
		isActive={isActive}
		onClick={onClick}
		style={style}
		type="button">
		{children}
	</StyledTabButton>
)

export default McpConfigurationView
