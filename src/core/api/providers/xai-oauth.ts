import { ModelInfo, XAIModelId, xaiDefaultModelId, xaiModels } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import * as fs from "fs/promises"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"
import * as os from "os"
import * as path from "path"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { ApiHandler, CommonApiHandlerOptions } from "../types"

interface XAIOauthHandlerOptions extends CommonApiHandlerOptions {
	xaiApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class XAIOauthHandler implements ApiHandler {
	private options: XAIOauthHandlerOptions
	private client: OpenAI | undefined

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
		// ensure reasoning effort is either "low" or "high" for grok-3-mini
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		if (modelId.includes("3-mini")) {
			let reasoningEffort = this.options.reasoningEffort
			if (reasoningEffort && !["low", "high"].includes(reasoningEffort)) {
				reasoningEffort = undefined
			}
		}
		const stream = await client.chat.completions.create({
			model: modelId,
			max_completion_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			reasoning_effort: reasoningEffort,
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
				if (!shouldSkipReasoningForModel(modelId)) {
					yield {
						type: "reasoning",
						// @ts-expect-error-next-line
						reasoning: delta.reasoning_content,
					}
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					// @ts-expect-error-next-line
					cacheWriteTokens: chunk.usage.prompt_tokens_details?.cached_creation_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		const id = modelId && modelId in xaiModels ? modelId : xaiDefaultModelId
		return { id, info: xaiModels[id as XAIModelId] }
	}
}
