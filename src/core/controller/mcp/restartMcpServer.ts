import type { IController as Controller } from "@core/controller/types"
import { StringRequest } from "@shared/proto/dietcode/common"
import { McpServers } from "@shared/proto/dietcode/mcp"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { Logger } from "@/shared/services/Logger"

/**
 * Restarts an MCP server connection
 * @param controller The controller instance
 * @param request The request containing the server name
 * @returns The updated list of MCP servers
 */
export async function restartMcpServer(controller: Controller, request: StringRequest): Promise<McpServers> {
	try {
		const mcpServers = await controller.mcpHub?.restartConnectionRPC(request.value)

		// Convert from McpServer[] to ProtoMcpServer[] ensuring all required fields are set
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		Logger.error(`Failed to restart MCP server ${request.value}:`, error)
		throw error
	}
}
