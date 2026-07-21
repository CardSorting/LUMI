import { ModelInfo, QwenTokenPlanModelId, qwenTokenPlanDefaultModelId, qwenTokenPlanModels } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { ApiHandler, CommonApiHandlerOptions } from "../types"

const QWEN_TOKEN_PLAN_BASE_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"

interface QwenTokenPlanHandlerOptions extends CommonApiHandlerOptions {
	qwenTokenPlanApiKey?: string
	apiModelId?: string
}

export class QwenTokenPlanHandler implements ApiHandler {
	private options: QwenTokenPlanHandlerOptions
	private client: OpenAI | undefined

	constructor(options: QwenTokenPlanHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.qwenTokenPlanApiKey) {
				throw new Error("Qwen Token Plan API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: QWEN_TOKEN_PLAN_BASE_URL,
					apiKey: this.options.qwenTokenPlanApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Qwen Token Plan client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: QwenTokenPlanModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in qwenTokenPlanModels) {
			const id = modelId as QwenTokenPlanModelId
			return { id, info: qwenTokenPlanModels[id] }
		}
		return {
			id: qwenTokenPlanDefaultModelId,
			info: qwenTokenPlanModels[qwenTokenPlanDefaultModelId],
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
			temperature: 0,
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
				try {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				} catch (error) {
					Logger.error("QwenTokenPlanHandler: Error processing tool call delta:", error)
				}
			}

			// Handle reasoning_content field (Qwen extended field)
			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-expect-error-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-expect-error-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}
}
