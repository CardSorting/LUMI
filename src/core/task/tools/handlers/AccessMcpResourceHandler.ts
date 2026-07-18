import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeAskUseMcpServer } from "@shared/ExtensionMessage"
import { truncateContent } from "@/shared/content-limits"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IPartialBlockHandler, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class AccessMcpResourceHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.MCP_ACCESS

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.server_name}']`
	}

	getApprovalIntent(block: ToolUse) {
		return declareApprovalIntent(block, {
			description: `Access MCP resource ${block.params.uri ?? ""}`,
			requirements: [
				{
					capability: "mcp",
					risk: "elevated",
					requestedSideEffects: ["remote resource access"],
					autoApprovalEligible: true,
				},
			],
			promptType: "use_mcp_server",
			notification: `DietCode wants to access ${block.params.uri ?? "an MCP resource"}`,
		})
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const server_name = block.params.server_name
		const uri = block.params.uri

		const partialMessage = JSON.stringify({
			type: this.name,
			serverName: uiHelpers.removeClosingTag(block, "server_name", server_name),
			toolName: undefined,
			uri: uiHelpers.removeClosingTag(block, "uri", uri),
			arguments: undefined,
		} satisfies DietCodeAskUseMcpServer)

		await uiHelpers.say("use_mcp_server", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const server_name: string | undefined = block.params.server_name
		const uri: string | undefined = block.params.uri

		// Validate required parameters
		if (!server_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(DietCodeDefaultTool.MCP_ACCESS, "server_name")
		}

		if (!uri) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(DietCodeDefaultTool.MCP_ACCESS, "uri")
		}

		config.taskState.consecutiveMistakeCount = 0

		await config.callbacks.say("mcp_server_request_started")

		// Execute the MCP resource access
		const resourceResult = await config.services.mcpHub.readResource(server_name, uri)

		// Process the resource result
		const resourceResultPretty =
			resourceResult?.contents
				.map((item: any) => {
					if (item.text) {
						return item.text
					}
					return ""
				})
				.filter(Boolean)
				.join("\n\n") || "(Empty response)"

		// Display result to user
		await config.callbacks.say("mcp_server_response", resourceResultPretty)

		// Truncate response if it exceeds 400KB to prevent context overflow
		const truncatedResult = truncateContent(resourceResultPretty)

		// Return formatted result
		return formatResponse.toolResult(truncatedResult)
	}
}
