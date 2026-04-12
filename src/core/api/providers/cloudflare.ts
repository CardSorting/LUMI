import { CloudflareModelId, cloudflareDefaultModelId, cloudflareModels, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface CloudflareHandlerOptions extends CommonApiHandlerOptions {
	cloudflareAccountId?: string
	cloudflareApiToken?: string
	apiModelId?: string
}

export class CloudflareHandler implements ApiHandler {
	private options: CloudflareHandlerOptions
	private client: OpenAI | undefined

	constructor(options: CloudflareHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.cloudflareAccountId) {
				throw new Error("Cloudflare Account ID is required")
			}
			if (!this.options.cloudflareApiToken) {
				throw new Error("Cloudflare API Token is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: `https://api.cloudflare.com/client/v4/accounts/${this.options.cloudflareAccountId}/ai/v1`,
					apiKey: this.options.cloudflareApiToken,
				})
			} catch (error: any) {
				throw new Error(`Error creating Cloudflare client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: CloudflareModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId as CloudflareModelId
		if (modelId && modelId in cloudflareModels) {
			return { id: modelId, info: cloudflareModels[modelId] }
		}
		return { id: cloudflareDefaultModelId, info: cloudflareModels[cloudflareDefaultModelId] }
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: CodemarieStorageMessage[], tools?: any[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
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

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					cacheWriteTokens: 0,
				}
			}
		}
	}
}
