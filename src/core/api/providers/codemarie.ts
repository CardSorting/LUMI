import { type ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { CodemarieEnv } from "@/config"
import { CodemarieAccountService } from "@/services/account/CodemarieAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { buildCodemarieExtraHeaders } from "@/services/EnvUtils"
import { CODEMARIE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/CodemarieAccount"
import type { CodemarieStorageMessage } from "@/shared/messages/content"
import { fetch, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import type { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import type { OpenRouterErrorResponse } from "./types"

interface CodemarieHandlerOptions extends CommonApiHandlerOptions {
	ulid?: string
	taskId?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	openRouterProviderSorting?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	codemarieAccountId?: string
	codemarieApiKey?: string
}

const CODEMARIE_FREE_MODELS = ["minimax/minimax-m2.5", "kwaipilot/kat-coder-pro", "z-ai/glm-5"]

export class CodemarieHandler implements ApiHandler {
	private options: CodemarieHandlerOptions
	private codemarieAccountService = CodemarieAccountService.getInstance()
	private _authService: AuthService
	private client: OpenAI | undefined
	lastGenerationId?: string
	private lastRequestId?: string

	private get _baseUrl(): string {
		return CodemarieEnv.config().apiBaseUrl
	}

	constructor(options: CodemarieHandlerOptions) {
		this.options = options
		this._authService = AuthService.getInstance()
	}

	private async ensureClient(): Promise<OpenAI> {
		const codemarieAccountAuthToken = this.options.codemarieApiKey || (await this._authService.getAuthToken())
		if (!codemarieAccountAuthToken) {
			throw new Error(CODEMARIE_ACCOUNT_AUTH_ERROR_MESSAGE)
		}
		if (!this.client) {
			try {
				const defaultHeaders: Record<string, string> = {
					"HTTP-Referer": "https://codemarie.bot",
					"X-Title": "Codemarie",
					"X-Task-ID": this.options.ulid || "",
				}
				Object.assign(defaultHeaders, await buildCodemarieExtraHeaders())

				this.client = new OpenAI({
					baseURL: `${this._baseUrl}/api/v1`,
					apiKey: codemarieAccountAuthToken,
					defaultHeaders,
					// Capture real HTTP request ID from initial streaming response headers
					fetch: async (...args: Parameters<typeof fetch>): Promise<Awaited<ReturnType<typeof fetch>>> => {
						const [input, init] = args
						const resp = await fetch(input, init)
						try {
							let urlStr = ""
							if (typeof input === "string") {
								urlStr = input
							} else if (input instanceof URL) {
								urlStr = input.toString()
							} else if (typeof (input as { url?: unknown }).url === "string") {
								urlStr = (input as { url: string }).url
							}
							// Only record for chat completions (the primary streaming request)
							if (urlStr.includes("/chat/completions")) {
								const rid = resp.headers.get("x-request-id") || resp.headers.get("request-id")
								if (rid) {
									this.lastRequestId = rid
								}
							}
						} catch {
							// ignore header capture errors
						}
						return resp
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Codemarie client: ${error.message}`)
			}
		}
		// Ensure the client is always using the latest auth token
		this.client.apiKey = codemarieAccountAuthToken
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: CodemarieStorageMessage[], tools?: OpenAITool[]): ApiStream {
		try {
			const client = await this.ensureClient()

			this.lastGenerationId = undefined
			this.lastRequestId = undefined

			let didOutputUsage = false

			const stream = await createOpenRouterStream(
				client,
				systemPrompt,
				messages,
				this.getModel(),
				this.options.reasoningEffort,
				this.options.thinkingBudgetTokens,
				this.options.openRouterProviderSorting,
				tools,
			)

			const toolCallProcessor = new ToolCallProcessor()

			for await (const chunk of stream) {
				Logger.debug(`CodemarieHandler chunk:${JSON.stringify(chunk)}`)
				// openrouter returns an error object instead of the openai sdk throwing an error
				if ("error" in chunk) {
					const error = chunk.error as OpenRouterErrorResponse["error"]
					Logger.error(`Codemarie API Error: ${error?.code} - ${error?.message}`)
					// Include metadata in the error message if available
					const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
					throw new Error(`Codemarie API Error ${error.code}: ${error.message}${metadataStr}`)
				}

				if (!this.lastGenerationId && chunk.id) {
					this.lastGenerationId = chunk.id
				}

				// Check for mid-stream error via finish_reason
				const choice = chunk.choices?.[0]
				// OpenRouter may return finish_reason = "error" with error details
				if ((choice?.finish_reason as string) === "error") {
					const choiceWithError = choice as any
					if (choiceWithError.error) {
						const error = choiceWithError.error
						Logger.error(`Codemarie Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
						throw new Error(`Codemarie Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
					}
					throw new Error(
						"Codemarie Mid-Stream Error: Stream terminated with error status but no error details provided",
					)
				}

				const delta = choice?.delta

				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if (delta?.tool_calls) {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				}

				// Reasoning tokens are returned separately from the content
				// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
				if (
					delta &&
					"reasoning" in delta &&
					delta.reasoning &&
					!shouldSkipReasoningForModel(this.options.openRouterModelId)
				) {
					yield {
						type: "reasoning",
						reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
					}
				}

				/* 
				OpenRouter passes reasoning details that we can pass back unmodified in api requests to preserve reasoning traces for model
				  - The reasoning_details array in each chunk may contain one or more reasoning objects
				  - For encrypted reasoning, the content may appear as [REDACTED] in streaming responses
				  - The complete reasoning sequence is built by concatenating all chunks in order
				See: https://openrouter.ai/docs/use-cases/reasoning-tokens#preserving-reasoning-blocks
				*/
				if (
					delta &&
					"reasoning_details" in delta &&
					delta.reasoning_details &&
					// @ts-expect-error-next-line
					delta?.reasoning_details?.length && // exists and non-0
					!shouldSkipReasoningForModel(this.options.openRouterModelId)
				) {
					yield {
						type: "reasoning",
						reasoning: "",
						details: delta.reasoning_details,
					}
				}

				if (!didOutputUsage && chunk.usage) {
					// @ts-expect-error-next-line
					let totalCost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)
					const modelId = this.getModel().id
					const isFreeModel = CODEMARIE_FREE_MODELS.includes(modelId)

					if (isFreeModel) {
						totalCost = 0
					}

					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
						outputTokens: chunk.usage.completion_tokens || 0,
						totalCost,
					}
					didOutputUsage = true
				}
			}

			// Fallback to generation endpoint if usage chunk not returned
			if (!didOutputUsage) {
				Logger.warn("Codemarie API did not return usage chunk, fetching from generation endpoint")
				const apiStreamUsage = await this.getApiStreamUsage()
				if (apiStreamUsage) {
					yield apiStreamUsage
				}
			}
		} catch (error) {
			Logger.error("Codemarie API Error:", error)
			throw error
		}
	}

	async embedText(text: string): Promise<number[] | null> {
		try {
			const client = await this.ensureClient()
			const response = await client.embeddings.create({
				model: "text-embedding-3-small", // Default embedding model for Codemarie
				input: text,
			})
			return response.data[0].embedding
		} catch (error) {
			Logger.error("Codemarie embedText error:", error)
			return null
		}
	}

	async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
		try {
			const client = await this.ensureClient()
			const response = await client.embeddings.create({
				model: "text-embedding-3-small",
				input: texts,
			})
			return response.data.map((item) => item.embedding)
		} catch (error) {
			Logger.error("Codemarie embedBatch error:", error)
			return texts.map(() => null)
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				const codemarieAccountAuthToken = await this._authService.getAuthToken()
				if (!codemarieAccountAuthToken) {
					throw new Error(CODEMARIE_ACCOUNT_AUTH_ERROR_MESSAGE)
				}
				const headers: Record<string, string> = {
					// Align with backend auth expectations
					Authorization: `Bearer ${codemarieAccountAuthToken}`,
				}
				Object.assign(headers, await buildCodemarieExtraHeaders())

				const response = await axios.get(
					`${this.codemarieAccountService.baseUrl}/generation?id=${this.lastGenerationId}`,
					{
						headers,
						timeout: 15_000, // this request hangs sometimes
						...getAxiosSettings(),
					},
				)

				const generation = response.data
				let totalCost = generation?.total_cost || 0
				const modelId = this.getModel().id
				const isFreeModel = CODEMARIE_FREE_MODELS.includes(modelId)

				if (isFreeModel) {
					totalCost = 0
				}

				return {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: generation?.native_tokens_cached || 0,
					// openrouter generation endpoint fails often
					inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost,
				}
			} catch (error) {
				// ignore if fails
				Logger.error("Error fetching codemarie generation details:", error)
			}
		}
		return undefined
	}

	// Expose the last HTTP request ID captured from response headers (X-Request-ID)
	getLastRequestId(): string | undefined {
		return this.lastRequestId
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		// If we have a model ID but no model info (e.g., CLI featured models),
		// use the ID with default model info rather than falling back to a different model
		if (modelId) {
			return { id: modelId, info: openRouterDefaultModelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
