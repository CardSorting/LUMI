import type { IController as Controller } from "@core/controller/types"
import { StringRequest } from "@shared/proto/dietcode/common"
import { McpServers } from "@shared/proto/dietcode/mcp"
import { Logger } from "@/shared/services/Logger"
import { convertMcpServersToProtoMcpServers } from "../../../shared/proto-conversions/mcp/mcp-server-conversion"

/**
 * Deletes an MCP server
 * @param controller The controller instance
 * @param request The delete server request
 * @returns The list of remaining MCP servers after deletion
 */
export async function deleteMcpServer(controller: Controller, request: StringRequest): Promise<McpServers> {
	try {
		// Call the RPC variant to delete the server and get updated server list
		const mcpServers = (await controller.mcpHub?.deleteServerRPC(request.value)) || []

		// Convert application types to protobuf types
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		Logger.error(`Failed to delete MCP server: ${error}`)
		throw error
	}
}
