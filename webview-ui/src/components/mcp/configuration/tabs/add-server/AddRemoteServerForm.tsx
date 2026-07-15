import { EmptyRequest } from "@shared/proto/dietcode/common"
import { AddRemoteMcpServerRequest, McpServers } from "@shared/proto/dietcode/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton, VSCodeLink, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { LINKS } from "@/constants"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

type TransportType = "streamableHttp" | "sse"

const AddRemoteServerForm = ({ onServerAdded }: { onServerAdded: () => void }) => {
	const [serverName, setServerName] = useState("")
	const [serverUrl, setServerUrl] = useState("")
	const [transportType, setTransportType] = useState<TransportType>("streamableHttp")
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState("")
	const { setMcpServers } = useExtensionState()

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (!serverName.trim()) {
			setError("Enter a name for this tool.")
			return
		}

		if (!serverUrl.trim()) {
			setError("Enter the tool’s connection URL.")
			return
		}

		try {
			new URL(serverUrl)
		} catch (_err) {
			setError("Enter a valid URL, including https://.")
			return
		}

		setError("")
		setIsSubmitting(true)

		try {
			const servers: McpServers = await McpServiceClient.addRemoteMcpServer(
				AddRemoteMcpServerRequest.create({
					serverName: serverName.trim(),
					serverUrl: serverUrl.trim(),
					transportType: transportType,
				}),
			)

			setIsSubmitting(false)

			const mcpServers = convertProtoMcpServersToMcpServers(servers.mcpServers)
			setMcpServers(mcpServers)

			setServerName("")
			setServerUrl("")
			onServerAdded()
		} catch (error) {
			setIsSubmitting(false)
			setError(error instanceof Error ? error.message : "Couldn’t connect this tool. Please try again.")
		}
	}

	return (
		<div className="p-4 px-5">
			<div className="mb-3 text-sm leading-relaxed text-(--vscode-foreground)">
				Enter the connection details provided by the tool’s developer or your administrator. Learn how{" "}
				<VSCodeLink href={LINKS.DOCUMENTATION.REMOTE_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					tool connections work.
				</VSCodeLink>
			</div>

			<form onSubmit={handleSubmit}>
				<div className="mb-2">
					<VSCodeTextField
						className="w-full"
						disabled={isSubmitting}
						onChange={(e) => {
							setServerName((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder="Documentation search"
						value={serverName}>
						Tool name
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						className="w-full mr-4"
						disabled={isSubmitting}
						onChange={(e) => {
							setServerUrl((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder="https://example.com/tool"
						value={serverUrl}>
						Connection URL
					</VSCodeTextField>
				</div>

				<div className="mb-3">
					<span
						className={`block text-sm font-medium mb-2 ${isSubmitting ? "opacity-50" : ""}`}
						id="connection-type-label">
						Connection type
					</span>
					<VSCodeRadioGroup
						aria-labelledby="connection-type-label"
						disabled={isSubmitting}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement).value as TransportType
							setTransportType(value)
						}}
						value={transportType}>
						<VSCodeRadio checked={transportType === "streamableHttp"} value="streamableHttp">
							Recommended (HTTP)
						</VSCodeRadio>
						<VSCodeRadio checked={transportType === "sse"} value="sse">
							Legacy (SSE)
						</VSCodeRadio>
					</VSCodeRadioGroup>
				</div>

				{error && (
					<div className="mb-3 text-(--vscode-errorForeground)" role="alert">
						{error}
					</div>
				)}

				<VSCodeButton className="w-full" disabled={isSubmitting} type="submit">
					{isSubmitting ? "Connecting…" : "Connect tool"}
				</VSCodeButton>

				<VSCodeButton
					appearance="secondary"
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}
					style={{ width: "100%", marginBottom: "5px", marginTop: 15 }}>
					Edit advanced configuration
				</VSCodeButton>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
