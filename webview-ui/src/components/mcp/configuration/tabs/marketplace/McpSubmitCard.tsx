import { VscIcon } from "@/components/ui/vsc-icon"

const McpSubmitCard = () => {
	return (
		<aside
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "12px",
				padding: "15px",
				margin: "20px",
				backgroundColor: "var(--vscode-textBlockQuote-background)",
				borderRadius: "6px",
			}}>
			{/* Icon */}
			<VscIcon className="" name="add" style={{ fontSize: "18px" }} />

			{/* Content */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "4px",
					textAlign: "center",
					maxWidth: "480px",
				}}>
				<h3
					style={{
						margin: 0,
						fontSize: "14px",
						fontWeight: 600,
						color: "var(--vscode-foreground)",
					}}>
					Share a tool
				</h3>
				<p style={{ fontSize: "13px", margin: 0, color: "var(--vscode-descriptionForeground)" }}>
					Built a useful connection? Help others discover it by submitting it to the{" "}
					<a href="https://github.com/dietcode/mcp-marketplace">community tool directory</a>.
				</p>
			</div>
		</aside>
	)
}

export default McpSubmitCard
