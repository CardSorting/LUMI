import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { McpServers } from "@shared/proto/dietcode/mcp"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { Logger } from "@/shared/services/Logger"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<McpServers>("mcpServers")

/**
 * Subscribe to MCP servers events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpServers(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<McpServers>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "mcpServers_subscription" })

	if (controller.mcpHub) {
		const mcpServers = controller.mcpHub.getServers()
		if (mcpServers.length > 0) {
			try {
				const protoServers = McpServers.create({
					mcpServers: convertMcpServersToProtoMcpServers(mcpServers),
				})
				await responseStream(protoServers, false)
			} catch (error) {
				Logger.error("Error sending initial MCP servers:", error)
			}
		}
	}
}

/**
 * Send an MCP servers update to all active subscribers
 * @param mcpServers The MCP servers to send
 */
export async function sendMcpServersUpdate(mcpServers: McpServers): Promise<void> {
	await hub.broadcast(mcpServers)
}
