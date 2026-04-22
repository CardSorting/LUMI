import { ModelInfo, NousResearchModelId, nousResearchDefaultModelId, nousResearchModels } from "@shared/api"
import OpenAI from "openai"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface NousResearchHandlerOptions extends CommonApiHandlerOptions {
	nousResearchApiKey?: string
	apiModelId?: string
}

export class NousResearchHandler implements ApiHandler {
	private options: NousResearchHandlerOptions
	private client: OpenAI | undefined

	constructor(options: NousResearchHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nousResearchApiKey) {
				throw new Error("NousResearch API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://inference-api.nousresearch.com/v1",
					apiKey: this.options.nousResearchApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating NousResearch client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: openAiMessages,
			max_tokens: model.info.maxTokens && model.info.maxTokens > 0 ? model.info.maxTokens : undefined,
			stream: true,
		})

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
					id: chunk.id,
				}
			}

			if (
				delta &&
				("reasoning" in delta || "reasoning_content" in delta) &&
				((delta as any).reasoning || (delta as any).reasoning_content)
			) {
				yield {
					type: "reasoning",
					reasoning: ((delta as any).reasoning || (delta as any).reasoning_content || "") as string,
					id: chunk.id,
				}
			}

			if (delta && "reasoning_details" in delta && (delta as any).reasoning_details) {
				const details = (delta as any).reasoning_details
				if (Array.isArray(details)) {
					for (const detail of details) {
						if (detail.text) {
							yield {
								type: "reasoning",
								reasoning: detail.text,
								id: chunk.id,
							}
						}
					}
				}
			}

			if (chunk.usage) {
				const usage = chunk.usage as any
				yield {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					thoughtsTokenCount: usage.completion_tokens_details?.reasoning_tokens || 0,
					cacheReadTokens: usage.prompt_tokens_details?.cached_tokens || 0,
					cacheWriteTokens: usage.cache_creation_input_tokens || 0,
					id: chunk.id,
				}
			}
		}
	}

	getModel(): { id: NousResearchModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in nousResearchModels) {
			const id = modelId as NousResearchModelId
			return { id, info: nousResearchModels[id] }
		}
		return { id: nousResearchDefaultModelId, info: nousResearchModels[nousResearchDefaultModelId] }
	}
}
