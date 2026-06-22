import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { McpMarketplaceCatalog } from "@shared/proto/dietcode/mcp"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

const hub = new PersistentSubscriptionHub<McpMarketplaceCatalog>("mcpMarketplaceCatalog")

/**
 * Subscribe to MCP marketplace catalog updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpMarketplaceCatalog(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<McpMarketplaceCatalog>,
	requestId?: string,
): Promise<void> {
	hub.register(responseStream, requestId, { type: "mcp_marketplace_subscription" })
}

/**
 * Send an MCP marketplace catalog event to all active subscribers
 */
export async function sendMcpMarketplaceCatalogEvent(catalog: McpMarketplaceCatalog): Promise<void> {
	await hub.broadcast(catalog)
}
