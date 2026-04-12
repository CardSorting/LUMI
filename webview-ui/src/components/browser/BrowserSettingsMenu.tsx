import { EmptyRequest } from "@shared/proto/codemarie/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BrowserServiceClient } from "../../services/grpc-client"

interface ConnectionInfo {
	isConnected: boolean
	isRemote: boolean
	host?: string
}

export const BrowserSettingsMenu = () => {
	const { browserSettings, navigateToSettings } = useExtensionState()
	const containerRef = useRef<HTMLDivElement>(null)
	const [showInfoPopover, setShowInfoPopover] = useState(false)
	const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({
		isConnected: false,
		isRemote: !!browserSettings.remoteBrowserEnabled,
		host: browserSettings.remoteBrowserHost,
	})
	const popoverRef = useRef<HTMLDivElement>(null)

	// Get actual connection info from the browser session using gRPC
	useEffect(() => {
		// Function to fetch connection info
		;(async () => {
			try {
				console.log("[DEBUG] SENDING BROWSER CONNECTION INFO REQUEST")
				const info = await BrowserServiceClient.getBrowserConnectionInfo(EmptyRequest.create({}))
				console.log("[DEBUG] GOT BROWSER REPLY:", info, typeof info)
				setConnectionInfo({
					isConnected: info.isConnected,
					isRemote: info.isRemote,
					host: info.host,
				})
			} catch (error) {
				console.error("Error fetching browser connection info:", error)
			}
		})()

		// No need for message event listeners anymore!
	}, [])

	// Close popover when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				popoverRef.current &&
				!popoverRef.current.contains(event.target as Node) &&
				!event.composedPath().some((el) => (el as HTMLElement).classList?.contains("browser-info-icon"))
			) {
				setShowInfoPopover(false)
			}
		}

		if (showInfoPopover) {
			document.addEventListener("mousedown", handleClickOutside)
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showInfoPopover])

	const openBrowserSettings = () => {
		navigateToSettings("browser")
	}

	const toggleInfoPopover = () => {
		setShowInfoPopover(!showInfoPopover)

		// Request updated connection info when opening the popover using gRPC
		if (!showInfoPopover) {
			const fetchConnectionInfo = async () => {
				try {
					const info = await BrowserServiceClient.getBrowserConnectionInfo(EmptyRequest.create({}))
					setConnectionInfo({
						isConnected: info.isConnected,
						isRemote: info.isRemote,
						host: info.host,
					})
				} catch (error) {
					console.error("Error fetching browser connection info:", error)
				}
			}

			fetchConnectionInfo()
		}
	}

	// Determine icon name based on connection state
	const getIconName = () => {
		if (connectionInfo.isRemote) {
			return "remote"
		}
		return connectionInfo.isConnected ? "vm-running" : "info"
	}

	// Determine icon color based on connection state
	const getIconColor = () => {
		if (connectionInfo.isRemote) {
			return connectionInfo.isConnected ? "var(--vscode-charts-blue)" : "var(--vscode-foreground)"
		}
		if (connectionInfo.isConnected) {
			return "var(--vscode-charts-green)"
		}
		return "var(--vscode-foreground)"
	}

	// Check connection status every second to keep icon in sync using gRPC
	useEffect(() => {
		// Function to fetch connection info
		const fetchConnectionInfo = async () => {
			try {
				const info = await BrowserServiceClient.getBrowserConnectionInfo(EmptyRequest.create({}))
				setConnectionInfo({
					isConnected: info.isConnected,
					isRemote: info.isRemote,
					host: info.host,
				})
			} catch (error) {
				console.error("Error fetching browser connection info:", error)
			}
		}

		// Request connection info immediately
		fetchConnectionInfo()

		// Set up interval to refresh every second
		const intervalId = setInterval(fetchConnectionInfo, 1000)

		return () => clearInterval(intervalId)
	}, [])

	return (
		<div ref={containerRef} style={{ position: "relative", marginTop: "-1px", display: "flex" }}>
			<VSCodeButton
				appearance="icon"
				className="browser-info-icon"
				onClick={toggleInfoPopover}
				style={{ marginRight: "4px" }}
				title="Browser connection info">
				<VscIcon
					className=""
					name={getIconName()}
					style={{
						fontSize: "14.5px",
						color: getIconColor(),
					}}
				/>
			</VSCodeButton>

			{showInfoPopover && (
				// InfoPopover - Dropdown container with connection details
				<div
					className="absolute top-[30px] right-0 z-100 w-[60dvw] max-w-[250px] rounded p-2.5 shadow-lg"
					ref={popoverRef}
					style={{
						backgroundColor: "var(--vscode-editorWidget-background)",
						border: "1px solid var(--vscode-widget-border)",
						boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
					}}>
					<h4 style={{ margin: "0 0 8px 0" }}>Browser Connection</h4>
					{/* InfoRow - Status row container */}
					<div className="flex flex-wrap whitespace-nowrap mb-1">
						{/* InfoLabel - Fixed-width label */}
						<div className="flex-none w-[90px] font-medium">Status:</div>
						{/* InfoValue - Flexible value container */}
						<div
							className="flex-1 break-words"
							style={{
								color: connectionInfo.isConnected
									? "var(--vscode-charts-green)"
									: "var(--vscode-errorForeground)",
							}}>
							{connectionInfo.isConnected ? "Connected" : "Disconnected"}
						</div>
					</div>
					{connectionInfo.isConnected && (
						// InfoRow - Type row container
						<div className="flex flex-wrap whitespace-nowrap mb-1">
							{/* InfoLabel - Fixed-width label */}
							<div className="flex-none w-[90px] font-medium">Type:</div>
							{/* InfoValue - Flexible value container */}
							<div className="flex-1 break-words">{connectionInfo.isRemote ? "Remote" : "Local"}</div>
						</div>
					)}
					{connectionInfo.isConnected && connectionInfo.isRemote && connectionInfo.host && (
						// InfoRow - Remote host row container
						<div className="flex flex-wrap whitespace-nowrap mb-1">
							{/* InfoLabel - Fixed-width label */}
							<div className="flex-none w-[90px] font-medium">Remote Host:</div>
							{/* InfoValue - Flexible value container */}
							<div className="flex-1 break-words">{connectionInfo.host}</div>
						</div>
					)}
				</div>
			)}

			<VSCodeButton appearance="icon" onClick={openBrowserSettings}>
				<VscIcon className="" name="settings-gear" style={{ fontSize: "14.5px" }} />
			</VSCodeButton>
		</div>
	)
}

export default BrowserSettingsMenu
