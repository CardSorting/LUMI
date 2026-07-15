import { McpMarketplaceItem, McpServer } from "@shared/mcp"
import { StringRequest } from "@shared/proto/dietcode/common"
import { useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

interface McpMarketplaceCardProps {
	item: McpMarketplaceItem
	installedServers: McpServer[]
	setError: (error: string | null) => void
}

const McpMarketplaceCard = ({ item, installedServers, setError }: McpMarketplaceCardProps) => {
	const isInstalled = installedServers.some((server) => server.name === item.mcpId)
	const [isDownloading, setIsDownloading] = useState(false)
	const githubLinkRef = useRef<HTMLDivElement>(null)
	const { onRelinquishControl } = useExtensionState()

	useEffect(() => {
		return onRelinquishControl(() => {
			setIsDownloading(false)
		})
	}, [onRelinquishControl])

	const githubAuthorUrl = useMemo(() => {
		try {
			const url = new URL(item.githubUrl)
			const pathParts = url.pathname.split("/")
			if (pathParts.length >= 2) {
				return `${url.origin}/${pathParts[1]}`
			}
		} catch {
			return item.githubUrl
		}
		return item.githubUrl
	}, [item.githubUrl])

	const handleInstall = async () => {
		if (isInstalled || isDownloading) return
		setIsDownloading(true)
		try {
			const response = await McpServiceClient.downloadMcp(StringRequest.create({ value: item.mcpId }))
			if (response.error) {
				console.error("Tool download failed:", response.error)
				setError(response.error)
			} else {
				setError(null)
			}
		} catch (error) {
			console.error("Failed to add tool:", error)
			setError(`Couldn’t add ${item.name}. Please try again.`)
		} finally {
			setIsDownloading(false)
		}
	}

	return (
		<>
			<style>
				{`
					.mcp-card {
					}
					.mcp-card:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
				`}
			</style>
			<article
				className="mcp-card"
				style={{
					padding: "14px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 12,
					color: "inherit",
				}}>
				{/* Main container with logo and content */}
				<div style={{ display: "flex", gap: "12px" }}>
					{/* Logo */}
					{item.logoUrl && (
						<img
							alt={`${item.name} logo`}
							src={item.logoUrl}
							style={{
								width: 42,
								height: 42,
								borderRadius: 4,
							}}
						/>
					)}

					{/* Content section */}
					<div
						style={{
							flex: 1,
							minWidth: 0,
							display: "flex",
							flexDirection: "column",
							justifyContent: "space-between",
						}}>
						{/* First row: name and install button */}
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "16px",
							}}>
							<h3 style={{ margin: 0, fontSize: "13px", fontWeight: 600 }}>
								<a href={item.githubUrl} style={{ color: "inherit", textDecoration: "none" }}>
									{item.name}
								</a>
							</h3>
							<StyledInstallButton
								$isInstalled={isInstalled}
								aria-label={isInstalled ? `${item.name} is added` : `Add ${item.name}`}
								disabled={isInstalled || isDownloading}
								onClick={handleInstall}
								type="button">
								{isInstalled ? "Added" : isDownloading ? "Adding…" : "Add"}
							</StyledInstallButton>
						</div>

						{/* Second row: metadata */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								flexWrap: "wrap",
								minWidth: 0,
								rowGap: 0,
							}}>
							<a
								className="github-link"
								href={githubAuthorUrl}
								onMouseEnter={(e) => {
									e.currentTarget.style.opacity = "1"
									e.currentTarget.style.color = "var(--link-active-foreground)"
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.opacity = "0.7"
									e.currentTarget.style.color = "var(--vscode-foreground)"
								}}
								style={{
									display: "flex",
									alignItems: "center",
									color: "var(--vscode-foreground)",
									minWidth: 0,
									opacity: 0.7,
									textDecoration: "none",
									border: "none !important",
								}}>
								<div ref={githubLinkRef} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
									<VscIcon className="" name="github" style={{ fontSize: "14px" }} />
									<span
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											wordBreak: "break-all",
											minWidth: 0,
										}}>
										{item.author}
									</span>
								</div>
							</a>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "4px",
									minWidth: 0,
									flexShrink: 0,
								}}>
								<VscIcon className="" name="star-full" />
								<span style={{ wordBreak: "break-all" }}>{item.githubStars?.toLocaleString() ?? 0}</span>
							</div>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "4px",
									minWidth: 0,
									flexShrink: 0,
								}}>
								<VscIcon className="" name="cloud-download" />
								<span style={{ wordBreak: "break-all" }}>{item.downloadCount?.toLocaleString() ?? 0}</span>
							</div>
							{item.requiresApiKey && (
								<VscIcon className="" name="key" style={{ flexShrink: 0 }} title="Requires API key" />
							)}
						</div>
					</div>
				</div>

				{/* Description and tags */}
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					{/* {!item.isRecommended && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "4px",
								fontSize: "12px",
								color: "var(--vscode-notificationsWarningIcon-foreground)",
								marginTop: -3,
								marginBottom: -3,
							}}>
							<VscIcon name="warning" className="" style={{ fontSize: "14px" }} />
							<span>Community Made (use at your own risk)</span>
						</div>
					)} */}

					<p style={{ fontSize: "13px", margin: 0 }}>{item.description}</p>
					<div
						onScroll={(e) => {
							const target = e.currentTarget
							const gradient = target.querySelector(".tags-gradient") as HTMLElement
							if (gradient) {
								gradient.style.visibility = target.scrollLeft > 0 ? "hidden" : "visible"
							}
						}}
						style={{
							display: "flex",
							gap: "6px",
							flexWrap: "nowrap",
							overflowX: "auto",
							scrollbarWidth: "none",
							position: "relative",
						}}>
						<span
							style={{
								fontSize: "10px",
								padding: "1px 4px",
								borderRadius: "3px",
								border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 50%, transparent)",
								color: "var(--vscode-descriptionForeground)",
								whiteSpace: "nowrap",
							}}>
							{item.category}
						</span>
						{item.tags.map((tag, index) => (
							<span
								key={tag}
								style={{
									fontSize: "10px",
									padding: "1px 4px",
									borderRadius: "3px",
									border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 50%, transparent)",
									color: "var(--vscode-descriptionForeground)",
									whiteSpace: "nowrap",
									display: "inline-flex",
								}}>
								{tag}
								{index === item.tags.length - 1 ? "" : ""}
							</span>
						))}
						<div
							className="tags-gradient"
							style={{
								position: "absolute",
								right: 0,
								top: 0,
								bottom: 0,
								width: "32px",
								background: "linear-gradient(to right, transparent, var(--vscode-sideBar-background))",
								pointerEvents: "none",
							}}
						/>
					</div>
				</div>
			</article>
		</>
	)
}

const StyledInstallButton = styled.button<{ $isInstalled?: boolean }>`
	font-size: 12px;
	font-weight: 500;
	padding: 2px 6px;
	border-radius: 2px;
	border: none;
	cursor: pointer;
	background: ${(props) =>
		props.$isInstalled ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)"};
	color: var(--vscode-button-foreground);

	&:hover:not(:disabled) {
		background: ${(props) =>
			props.$isInstalled ? "var(--vscode-button-secondaryHoverBackground)" : "var(--vscode-button-hoverBackground)"};
	}

	&:active:not(:disabled) {
		background: ${(props) =>
			props.$isInstalled ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)"};
		opacity: 0.7;
	}

	&:focus-visible {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}

	&:disabled {
		opacity: 0.5;
		cursor: default;
	}
`

export default McpMarketplaceCard
