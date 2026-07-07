import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { clinePassDefaultModelId, clinePassModels, ModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { ApiHandler, CommonApiHandlerOptions } from "../types"
import { OpenRouterErrorResponse } from "./types"

interface ClinePassHandlerOptions extends CommonApiHandlerOptions {
	clineApiKey?: string
	apiModelId?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
}

export class ClinePassHandler implements ApiHandler {
	private options: ClinePassHandlerOptions
	private client: OpenAI | undefined
	lastGenerationId?: string

	constructor(options: ClinePassHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.clineApiKey) {
				throw new Error("Cline API key is required")
			}
			try {
				const baseURL = "https://api.cline.bot/api/v1"
				this.client = createOpenAIClient({
					baseURL,
					apiKey: this.options.clineApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating ClinePass client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		this.lastGenerationId = undefined

		try {
			const stream = await createOpenRouterStream(
				client,
				systemPrompt,
				messages,
				this.getModel(),
				this.options.reasoningEffort,
				this.options.thinkingBudgetTokens,
				undefined, // no provider sorting
				tools,
			)

			let didOutputUsage = false
			const toolCallProcessor = new ToolCallProcessor()

			for await (const chunk of stream) {
				if ("error" in chunk) {
					const error = chunk.error as OpenRouterErrorResponse["error"]
					Logger.error(`ClinePass API Error: ${error?.code} - ${error?.message}`)
					const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
					throw new Error(`ClinePass API Error ${error.code}: ${error.message}${metadataStr}`)
				}

				const choice = chunk.choices?.[0]
				if ((choice?.finish_reason as string) === "error") {
					const choiceWithError = choice as any
					if (choiceWithError.error) {
						const error = choiceWithError.error
						Logger.error(
							`ClinePass Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`,
						)
						const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)
						throw new Error(`ClinePass Mid-Stream Error: ${errorDetails}`)
					}
					throw new Error(
						`ClinePass Mid-Stream Error: Stream terminated with error status but no error details provided`,
					)
				}

				if (!this.lastGenerationId && chunk.id) {
					this.lastGenerationId = chunk.id
				}

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

				if (delta && "reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.apiModelId)) {
					yield {
						type: "reasoning",
						reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
					}
				}

				if (
					delta &&
					"reasoning_details" in delta &&
					delta.reasoning_details &&
					// @ts-expect-error-next-line
					delta.reasoning_details.length &&
					!shouldSkipReasoningForModel(this.options.apiModelId)
				) {
					yield {
						type: "reasoning",
						reasoning: "",
						details: delta.reasoning_details,
					}
				}

				if (!didOutputUsage && chunk.usage) {
					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
						outputTokens: chunk.usage.completion_tokens || 0,
						// @ts-expect-error-next-line
						totalCost: (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0),
					}
					didOutputUsage = true
				}
			}

			if (!didOutputUsage) {
				const apiStreamUsage = await this.getApiStreamUsage()
				if (apiStreamUsage) {
					yield apiStreamUsage
				}
			}
		} catch (error: any) {
			const errorMessage = error?.message || String(error)
			const normalized = errorMessage.toLowerCase()

			if (
				normalized.includes("the user is not subscribed to required model plan") ||
				normalized.includes("no access to clinepass subscription models yet") ||
				normalized.includes("subscribe to clinepass") ||
				error?.status === 403
			) {
				if (normalized.includes("organization accounts cannot use")) {
					throw new Error(
						"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass",
					)
				}
				throw new Error(
					"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://cline.bot/dashboard/subscription?personal=true",
				)
			}

			throw error
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			await setTimeoutPromise(500)
			try {
				const generationIterator = this.fetchGenerationDetails(this.lastGenerationId)
				const generation = (await generationIterator.next()).value
				return {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: generation?.native_tokens_cached || 0,
					inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				Logger.error("Error fetching ClinePass details:", error)
			}
		}
		return undefined
	}

	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		try {
			const baseURL = "https://api.cline.bot/api/v1"
			const response = await axios.get(`${baseURL}/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.clineApiKey}`,
				},
				timeout: 15_000,
				...getAxiosSettings(),
			})
			yield response.data?.data
		} catch (error) {
			Logger.error("Error fetching ClinePass generation details:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId || clinePassDefaultModelId
		const cachedModelInfo = clinePassModels[modelId as keyof typeof clinePassModels]
		return {
			id: modelId,
			info: cachedModelInfo || {
				maxTokens: 8_192,
				contextWindow: 128_000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsReasoning: true,
				inputPrice: 0,
				outputPrice: 0,
				cacheReadsPrice: 0,
				cacheWritesPrice: 0,
			},
		}
	}
}
