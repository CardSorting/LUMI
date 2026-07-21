import {
	codingZAiDefaultModelId,
	codingZAiModelId,
	codingZAiModels,
	internationalZAiDefaultModelId,
	internationalZAiModelId,
	internationalZAiModels,
	ModelInfo,
	mainlandZAiDefaultModelId,
	mainlandZAiModelId,
	mainlandZAiModels,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { buildOpenRouterAttributionHeaders } from "@/services/EnvUtils"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { version as extensionVersion } from "../../../../package.json"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { ApiHandler, CommonApiHandlerOptions } from "../types"

interface ZAiHandlerOptions extends CommonApiHandlerOptions {
	zaiApiLine?: string
	zaiApiKey?: string
	apiModelId?: string
	customModelInfo?: ModelInfo
}

export class ZAiHandler implements ApiHandler {
	private options: ZAiHandlerOptions
	private client: OpenAI | undefined
	constructor(options: ZAiHandlerOptions) {
		this.options = options
	}

	private useChinaApi(): boolean {
		return this.options.zaiApiLine === "china"
	}

	private useCodingApi(): boolean {
		return this.options.zaiApiLine === "coding"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.zaiApiKey) {
				throw new Error("Z AI API key is required")
			}
			try {
				let baseURL = "https://api.z.ai/api/paas/v4"
				if (this.options.zaiApiLine === "china") {
					baseURL = "https://open.bigmodel.cn/api/paas/v4"
				} else if (this.options.zaiApiLine === "coding") {
					baseURL = "https://api.z.ai/api/coding/paas/v4"
				}
				this.client = createOpenAIClient({
					baseURL,
					apiKey: this.options.zaiApiKey,
					defaultHeaders: {
						...buildOpenRouterAttributionHeaders(),
						"X-DietCode-Version": extensionVersion,
					},
				})
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error)
				throw new Error(`Error creating Z AI client: ${msg}`)
			}
		}
		return this.client
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (this.options.customModelInfo && modelId) {
			return { id: modelId, info: this.options.customModelInfo }
		}

		if (this.useCodingApi()) {
			if (modelId && modelId in codingZAiModels) {
				const id = modelId as codingZAiModelId
				return { id, info: codingZAiModels[id] }
			}
			if (modelId) {
				// Custom model string passed for coding API line
				const contextWindow = modelId.includes("glm-5.2") ? 1_000_000 : 200_000
				return {
					id: modelId,
					info: {
						maxTokens: 128_000,
						contextWindow,
						supportsImages: false,
						supportsPromptCache: true,
					},
				}
			}
			return {
				id: codingZAiDefaultModelId,
				info: codingZAiModels[codingZAiDefaultModelId],
			}
		}

		if (this.useChinaApi()) {
			const id = modelId && modelId in mainlandZAiModels ? (modelId as mainlandZAiModelId) : mainlandZAiDefaultModelId
			return {
				id,
				info: mainlandZAiModels[id],
			}
		}

		if (modelId && modelId in internationalZAiModels) {
			const id = modelId as internationalZAiModelId
			return { id, info: internationalZAiModels[id] }
		}

		if (modelId) {
			const contextWindow = modelId.includes("glm-5.2") ? 1_000_000 : 200_000
			return {
				id: modelId,
				info: {
					maxTokens: 128_000,
					contextWindow,
					supportsImages: false,
					supportsPromptCache: true,
				},
			}
		}

		return {
			id: internationalZAiDefaultModelId,
			info: internationalZAiModels[internationalZAiDefaultModelId],
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[], tools?: OpenAITool[]): ApiStream {
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
