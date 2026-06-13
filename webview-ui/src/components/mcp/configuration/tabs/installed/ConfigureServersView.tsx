import { EmptyRequest } from "@shared/proto/dietcode/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import ServersToggleList from "./ServersToggleList"

const ConfigureServersView = () => {
	const { mcpServers: servers, navigateToSettings, remoteConfigSettings } = useExtensionState()

	// Check if there are remote MCP servers configured
	const hasRemoteMCPServers = remoteConfigSettings?.remoteMCPServers && remoteConfigSettings.remoteMCPServers.length > 0

	return (
		<div style={{ padding: "16px 20px" }}>
			<div
				style={{
					color: "var(--vscode-foreground)",
					fontSize: "13px",
					marginBottom: "16px",
					marginTop: "5px",
				}}>
				Connect MIRA to extra tools in your workspace — pick from the community, or describe what you need in chat (like
				"add a tool that fetches npm docs").{" "}
				<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
					See a demo here.
				</VSCodeLink>
			</div>

			{/* Remote config banner */}
			{hasRemoteMCPServers && (
				<div className="flex items-center gap-2 px-5 py-3 mb-4 bg-vscode-textBlockQuote-background border-l-[3px] border-vscode-textLink-foreground">
					<VscIcon className="text-sm" name="lock" />
					<span className="text-base">Your organization manages some extra tools</span>
				</div>
			)}

			<ServersToggleList hasTrashIcon={false} isExpandable={true} servers={servers} />

			{/* Settings Section */}
			<div style={{ marginBottom: "20px", marginTop: 10 }}>
				<VSCodeButton
					appearance="secondary"
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}
					style={{ width: "100%", marginBottom: "5px" }}>
					<VscIcon className="" name="server" style={{ marginRight: "6px" }} />
					Configure MCP Servers
				</VSCodeButton>

				<div style={{ textAlign: "center" }}>
					<VSCodeLink onClick={() => navigateToSettings("features")} style={{ fontSize: "12px" }}>
						Advanced MCP Settings
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default ConfigureServersView
