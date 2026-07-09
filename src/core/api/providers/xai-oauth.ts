import { ModelInfo, XAIModelId, xaiDefaultModelId, xaiModels } from "@shared/api"
import * as fs from "fs/promises"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import * as os from "os"
import * as path from "path"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { withRetry } from "../retry"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ApiHandler, CommonApiHandlerOptions } from "../types"

interface XAIOauthHandlerOptions extends CommonApiHandlerOptions {
	xaiApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class XAIOauthHandler implements ApiHandler {
	private options: XAIOauthHandlerOptions
	private client: OpenAI | undefined
	private pendingToolCallId: string | undefined
	private pendingToolCallName: string | undefined
	private abortController?: AbortController

	constructor(options: XAIOauthHandlerOptions) {
		this.options = options
	}

	private async getAuthToken(): Promise<string> {
		// 1. Try to read from ~/.hermes/auth.json
		try {
			const authPath = path.join(os.homedir(), ".hermes", "auth.json")
			const content = await fs.readFile(authPath, "utf-8")
			const data = JSON.parse(content)

			// Try to extract access token from providers["xai-oauth"] or credential_pool["xai-oauth"]
			const oauthToken =
				data.providers?.["xai-oauth"]?.access_token || data.credential_pool?.["xai-oauth"]?.[0]?.access_token
			if (oauthToken) {
				return oauthToken
			}
		} catch (err) {
			// Ignore file read error and fall back
		}

		// 2. Fallback to settings api key
		if (this.options.xaiApiKey) {
			return this.options.xaiApiKey
		}

		throw new Error(
			"xAI Grok OAuth token not found. Please run 'hermes auth add xai-oauth' in your terminal, or enter your token/API key under settings.",
		)
	}

	private async ensureClient(): Promise<OpenAI> {
		if (!this.client) {
			const token = await this.getAuthToken()
			try {
				this.client = createOpenAIClient({
					baseURL: "https://api.x.ai/v1",
					apiKey: token,
				})
			} catch (error: any) {
				throw new Error(`Error creating xAI OAuth client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = await this.ensureClient()
		const modelId = this.getModel().id

		// Reset state for this request
		this.pendingToolCallId = undefined
		this.pendingToolCallName = undefined
		this.abortController = new AbortController()

		const { input } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId: false })

		// Build request body for the Responses API
		const requestBody: any = {
			model: modelId,
			input: input,
			instructions: systemPrompt,
			stream: true,
		}

		if (tools && tools.length > 0) {
			requestBody.tools = tools
				.filter((tool: any) => tool?.type === "function")
				.map((tool: any) => ({
					type: "function",
					name: tool.function.name,
					description: tool.function.description,
					parameters: tool.function.parameters,
					strict: tool.function.strict ?? true,
				}))
		}

		try {
			const stream = (await (client as any).responses.create(requestBody, {
				signal: this.abortController.signal,
			})) as AsyncIterable<any>

			if (typeof (stream as any)?.[Symbol.asyncIterator] !== "function") {
				throw new Error("xAI Responses API did not return an AsyncIterable")
			}

			for await (const event of stream) {
				if (this.abortController.signal.aborted) {
					break
				}

				for await (const outChunk of this.processEvent(event)) {
					yield outChunk
				}
			}
		} finally {
			this.abortController = undefined
		}
	}

	private async *processEvent(event: any): ApiStream {
		// Handle text deltas
		if (event?.type === "response.text.delta" || event?.type === "response.output_text.delta") {
			if (event?.delta) {
				yield { type: "text", text: event.delta }
			}
			return
		}

		// Handle reasoning deltas
		if (
			event?.type === "response.reasoning.delta" ||
			event?.type === "response.reasoning_text.delta" ||
			event?.type === "response.reasoning_summary.delta" ||
			event?.type === "response.reasoning_summary_text.delta"
		) {
			if (event?.delta) {
				yield { type: "reasoning", reasoning: event.delta }
			}
			return
		}

		// Handle refusal deltas
		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				yield { type: "text", text: `[Refusal] ${event.delta}` }
			}
			return
		}

		// Handle tool/function call deltas
		if (event?.type === "response.tool_call_arguments.delta" || event?.type === "response.function_call_arguments.delta") {
			const callId = event.call_id || event.tool_call_id || event.id || this.pendingToolCallId
			const name = event.name || event.function_name || this.pendingToolCallName
			const args = event.delta || event.arguments

			if (typeof callId === "string" && callId.length > 0 && typeof name === "string" && name.length > 0) {
				yield {
					type: "tool_calls",
					tool_call: {
						call_id: callId,
						function: {
							id: callId,
							name,
							arguments: typeof args === "string" ? args : "",
						},
					},
				}
			}
			return
		}

		// Handle output item events
		if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
			const item = event?.item
			if (item) {
				// Capture tool identity for subsequent argument deltas
				if (item.type === "function_call" || item.type === "tool_call") {
					const callId = item.call_id || item.tool_call_id || item.id
					const name = item.name || item.function?.name || item.function_name
					if (typeof callId === "string" && callId.length > 0) {
						this.pendingToolCallId = callId
						this.pendingToolCallName = typeof name === "string" ? name : undefined
					}
				}

				if (item.type === "text" && item.text) {
					yield { type: "text", text: item.text }
				} else if (item.type === "reasoning" && item.text) {
					yield { type: "reasoning", reasoning: item.text }
				} else if (item.type === "message" && Array.isArray(item.content)) {
					for (const content of item.content) {
						if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
							yield { type: "text", text: content.text }
						}
					}
				} else if (
					(item.type === "function_call" || item.type === "tool_call") &&
					event.type === "response.output_item.done"
				) {
					const callId = item.call_id || item.tool_call_id || item.id
					if (callId) {
						const args = item.arguments || item.function?.arguments || item.function_arguments
						yield {
							type: "tool_calls",
							tool_call: {
								call_id: callId,
								function: {
									id: callId,
									name: item.name || item.function?.name || item.function_name || "",
									arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
								},
							},
						}
					}
				}
			}
			return
		}

		// Handle usage chunks
		if (event?.type === "response.done" && event?.response?.usage) {
			const usage = event.response.usage
			const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details
			const cachedFromDetails = inputDetails?.cached_tokens ?? 0
			const totalInputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
			const totalOutputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0
			const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0
			const cacheReadTokens =
				usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? cachedFromDetails ?? 0

			yield {
				type: "usage",
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
				cacheWriteTokens: cacheWriteTokens,
				cacheReadTokens: cacheReadTokens,
			} as ApiStreamUsageChunk
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		const id = modelId && modelId in xaiModels ? modelId : xaiDefaultModelId
		return { id, info: xaiModels[id as XAIModelId] }
	}
}
