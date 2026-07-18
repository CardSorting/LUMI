import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeAskUseMcpServer } from "@shared/ExtensionMessage"
import { truncateContent } from "@/shared/content-limits"
import { DietCodeDefaultTool } from "@/shared/tools"
import { executionFunnel } from "../execution/ExecutionFunnel"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IPartialBlockHandler, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class UseMcpToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.MCP_USE

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.server_name}']`
	}

	getApprovalIntent(block: ToolUse) {
		return declareApprovalIntent(block, {
			description: `Use MCP tool ${block.params.tool_name ?? ""} on ${block.params.server_name ?? ""}`,
			requirements: [
				{ capability: "mcp", risk: "high", requestedSideEffects: ["remote tool invocation"], autoApprovalEligible: true },
			],
			promptType: "use_mcp_server",
			notification: `DietCode wants to use ${block.params.tool_name ?? "an MCP tool"}`,
		})
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const server_name = block.params.server_name
		const tool_name = block.params.tool_name
		const mcp_arguments = block.params.arguments

		const partialMessage = JSON.stringify({
			type: "use_mcp_tool",
			serverName: uiHelpers.removeClosingTag(block, "server_name", server_name),
			toolName: uiHelpers.removeClosingTag(block, "tool_name", tool_name),
			arguments: uiHelpers.removeClosingTag(block, "arguments", mcp_arguments),
		} satisfies DietCodeAskUseMcpServer)

		await uiHelpers.say("use_mcp_server", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const server_name: string | undefined = block.params.server_name
		const tool_name: string | undefined = block.params.tool_name
		const mcp_arguments: string | undefined = block.params.arguments

		// Validate required parameters
		if (!server_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "server_name")
		}

		if (!tool_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "tool_name")
		}

		// Parse and validate arguments if provided
		let parsedArguments: Record<string, unknown> | undefined
		if (mcp_arguments) {
			try {
				parsedArguments = JSON.parse(mcp_arguments)
			} catch (_error) {
				config.taskState.consecutiveMistakeCount++
				await config.callbacks.say(
					"error",
					`DietCode tried to use ${tool_name} with an invalid JSON argument. Retrying...`,
				)
				return formatResponse.toolError(formatResponse.invalidMcpToolArgumentError(server_name, tool_name))
			}
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show MCP request started message
		await config.callbacks.say("mcp_server_request_started")

		try {
			// Check for any pending notifications before the tool call
			const notificationsBefore = config.services.mcpHub.getPendingNotifications()
			for (const notification of notificationsBefore) {
				await config.callbacks.say("mcp_notification", `[${notification.serverName}] ${notification.message}`)
			}

			// Execute the MCP tool with reliability wrapper
			const toolResult = await executionFunnel.executeReliableAction(
				config.taskId,
				config.taskState.executionGeneration,
				() => config.services.mcpHub.callTool(server_name, tool_name, parsedArguments, config.ulid),
				{ concurrencyGroup: "mcp" },
			)

			// Check for any pending notifications after the tool call
			const notificationsAfter = config.services.mcpHub.getPendingNotifications()
			for (const notification of notificationsAfter) {
				await config.callbacks.say("mcp_notification", `[${notification.serverName}] ${notification.message}`)
			}

			// Process tool result
			const toolResultImages =
				toolResult?.content
					.filter((item: any) => item.type === "image")
					.map((item: any) => `data:${item.mimeType};base64,${item.data}`) || []

			let toolResultText =
				(toolResult?.isError ? "Error:\n" : "") +
					toolResult?.content
						.map((item: any) => {
							if (item.type === "text") {
								return item.text
							}
							if (item.type === "resource") {
								const { blob: _blob, ...rest } = item.resource
								return JSON.stringify(rest, null, 2)
							}
							return ""
						})
						.filter(Boolean)
						.join("\n\n") || "(No response)"

			// webview extracts images from the text response to display in the UI
			const toolResultToDisplay = toolResultText + toolResultImages?.map((image: any) => `\n\n${image}`).join("")
			await config.callbacks.say("mcp_server_response", toolResultToDisplay)

			// Handle model image support
			const supportsImages = config.api.getModel().info.supportsImages ?? false
			if (toolResultImages.length > 0 && !supportsImages) {
				toolResultText += `\n\n[${toolResultImages.length} images were provided in the response, and while they are displayed to the user, you do not have the ability to view them.]`
			}

			// Truncate response if it exceeds 400KB to prevent context overflow
			toolResultText = truncateContent(toolResultText)

			// Return formatted result (only pass images if model supports them)
			return formatResponse.toolResult(toolResultText, supportsImages ? toolResultImages : undefined)
		} catch (error) {
			return `Error executing MCP tool: ${(error as Error)?.message}`
		}
	}
}
