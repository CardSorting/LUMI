import { McpServer } from "@shared/mcp"
import ServerRow from "./server-row/ServerRow"

const ServersToggleList = ({
	servers,
	isExpandable,
	hasTrashIcon,
	listGap = "medium",
}: {
	servers: McpServer[]
	isExpandable: boolean
	hasTrashIcon: boolean
	listGap?: "small" | "medium" | "large"
}) => {
	const gapClasses = {
		small: "gap-0",
		medium: "gap-2.5",
		large: "gap-5",
	}

	const gapClass = gapClasses[listGap]

	return servers.length > 0 ? (
		<div className={`flex flex-col ${gapClass}`}>
			{servers.map((server) => (
				<ServerRow hasTrashIcon={hasTrashIcon} isExpandable={isExpandable} key={server.name} server={server} />
			))}
		</div>
	) : (
		<output className="my-5 flex flex-col items-center gap-1 text-center text-(--vscode-descriptionForeground)">
			<span className="text-sm font-medium text-foreground">No tools connected yet</span>
			<span className="text-xs">Browse available tools or add one using its connection details.</span>
		</output>
	)
}

export default ServersToggleList
