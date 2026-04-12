// Restore GenerateContentConfig import and add GenerateContentResponseUsageMetadata
import {
	ApiError,
	FunctionCallingConfigMode,
	type GenerateContentConfig,
	type GenerateContentResponseUsageMetadata,
	GoogleGenAI,
	FunctionDeclaration as GoogleTool,
	HarmBlockThreshold,
	HarmCategory,
	ThinkingLevel,
} from "@google/genai"
import { GeminiModelId, geminiDefaultModelId, geminiModels, ModelInfo } from "@shared/api"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { telemetryService } from "@/services/telemetry"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { RetriableError, withRetry } from "../retry"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

const rateLimitPatterns = [/got status: 429/i, /429 Too Many Requests/i, /rate limit exceeded/i, /too many requests/i]

interface GeminiHandlerOptions extends CommonApiHandlerOptions {
	isVertex?: boolean
	vertexApiKey?: string
	geminiApiKey?: string
	geminiBaseUrl?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
	apiModelId?: string
	ulid?: string
}

function mapReasoningEffortToGeminiThinkingLevel(effort: string): ThinkingLevel {
	switch (effort) {
		case "low":
			return ThinkingLevel.LOW
		case "medium":
		case "high":
		case "xhigh":
			return ThinkingLevel.HIGH
		default:
			// Default to LOW for unknown efforts to be safe,
			// but use HIGH if it's explicitly one of the higher levels.
			return ThinkingLevel.LOW
	}
}

/**
 * Handler for Google's Gemini API with optimized caching strategy and accurate cost accounting.
 *
 * Key features:
 * - One cache per task: Creates a single cache per task and reuses it for subsequent turns
 * - Stable cache keys: Uses ulid as a stable identifier for caches
 * - Efficient cache updates: Only updates caches when there's new content to add
 * - Split cost accounting: Separates immediate costs from ongoing cache storage costs
 *
 * Cost accounting approach:
 * - Immediate costs (per message): Input tokens, output tokens, and cache read costs
 * - Ongoing costs (per task): Cache storage costs for the TTL period
 *
 * Gemini's caching system is unique in that it charges for holding tokens in cache by the hour.
 * This implementation optimizes for both performance and cost by:
 * 1. Minimizing redundant cache creations
 * 2. Properly accounting for cache costs in the billing calculations
 * 3. Using a stable cache key to ensure cache reuse across turns
 * 4. Separating immediate costs from ongoing costs to avoid double-counting
 */
export class GeminiHandler implements ApiHandler {
	private options: GeminiHandlerOptions
	private client: GoogleGenAI | undefined

	constructor(options: GeminiHandlerOptions) {
		// Store the options
		this.options = options
	}

	private ensureClient(): GoogleGenAI {
		if (!this.client) {
			const options = this.options as GeminiHandlerOptions
			const externalHeaders = buildExternalBasicHeaders()

			if (options.isVertex) {
				// Initialize with Vertex AI configuration
				try {
					const apiKey = options.vertexApiKey || options.geminiApiKey

					if (!apiKey) {
						throw new Error("Vertex AI requires an API Key")
					}

					const location = "us-central1"

					this.client = new GoogleGenAI({
						vertexai: true,
						location,
						apiKey,
						httpOptions: {
							headers: externalHeaders,
						},
					})
				} catch (error: any) {
					throw new Error(`Error creating Gemini Vertex AI client: ${error.message}`)
				}
			} else {
				// Initialize with standard API key
				if (!options.geminiApiKey) {
					throw new Error("API key is required for Google Gemini when not using Vertex AI")
				}

				try {
					this.client = new GoogleGenAI({
						apiKey: options.geminiApiKey,
						httpOptions: {
							headers: externalHeaders,
						},
					})
				} catch (error) {
					throw new Error(`Error creating Gemini client: ${error.message}`)
				}
			}
		}
		return this.client
	}

	/**
	 * Creates a message using the Gemini API with implicit caching.
	 *
	 * Cost accounting:
	 * - Immediate costs (returned in the usage object): Input tokens, output tokens, cache read costs
	 *
	 * @param systemPrompt The system prompt to use for the message
	 * @param messages The conversation history to include in the message
	 * @returns An async generator that yields chunks of the response with accurate immediate costs
	 */
	@withRetry({
		maxRetries: 4,
		baseDelay: 2000,
		maxDelay: 15000,
	})
	async *createMessage(systemPrompt: string, messages: CodemarieStorageMessage[], tools?: GoogleTool[]): ApiStream {
		const client = this.ensureClient()
		const { id: modelId, info } = this.getModel()
		const contents = messages.map((msg) => convertAnthropicMessageToGemini(msg, modelId))

		// Configure thinking budget/level if supported
		const _thinkingBudget = this.options.thinkingBudgetTokens ?? 0
		const maxBudget = info.thinkingConfig?.maxBudget ?? 24576
		const thinkingBudget = Math.min(_thinkingBudget, maxBudget)
		// When ThinkingLevel is defined, thinking budget cannot be zero
		// and only level is used to control thinking behavior.
		// Only set thinkingLevel for models that support it
		let thinkingLevel: ThinkingLevel | undefined
		const rawReasoningEffort = (this.options.reasoningEffort || "").toLowerCase()
		const normalizedReasoningEffort =
			!rawReasoningEffort || rawReasoningEffort === "none" || rawReasoningEffort === "off" ? "none" : rawReasoningEffort
		if (info.thinkingConfig?.supportsThinkingLevel) {
			if (normalizedReasoningEffort !== "none") {
				thinkingLevel = mapReasoningEffortToGeminiThinkingLevel(normalizedReasoningEffort)
			} else if (info.thinkingConfig.geminiThinkingLevel) {
				// Use model's default thinking level if none specified
				thinkingLevel = mapReasoningEffortToGeminiThinkingLevel(info.thinkingConfig.geminiThinkingLevel)
			}
		}

		// Set up base generation config
		const requestConfig: GenerateContentConfig = {
			// Add base URL if configured
			httpOptions: this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined,
			systemInstruction: systemPrompt,
			// Set temperature (default to 0)
			// Gemini 3 recommends 1.0
			temperature: info.temperature ?? 1,
			// Add safety settings to prevent false positives in coding tasks
			safetySettings: [
				{
					category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
					threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
				},
				{
					category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
					threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
				},
				{
					category: HarmCategory.HARM_CATEGORY_HARASSMENT,
					threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
				},
				{
					category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
					threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
				},
			],
		}

		// Add thinking config only if the model supports it
		if (info.thinkingConfig) {
			const finalThinkingBudget = thinkingBudget > 0 ? thinkingBudget : thinkingLevel ? 1024 : undefined
			requestConfig.thinkingConfig = {
				thinkingBudget: finalThinkingBudget,
				// Gemini allows only ONE of thinkingBudget or thinkingLevel.
				// We prioritize budget to avoid "Budget 0 is invalid".
				thinkingLevel: finalThinkingBudget ? undefined : thinkingLevel,
				includeThoughts: !!finalThinkingBudget || !!thinkingLevel,
			}
		}

		// Generate content using the configured parameters
		const sdkCallStartTime = Date.now()
		let responseId: string | undefined
		let sdkFirstChunkTime: number | undefined
		let ttftSdkMs: number | undefined
		let apiSuccess = false
		let apiError: string | undefined
		let promptTokens = 0
		let outputTokens = 0
		let cacheReadTokens = 0
		let thoughtsTokenCount = 0 // Initialize thought token counts
		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		const isNativeToolCallsEnabled = tools?.length
		if (isNativeToolCallsEnabled) {
			requestConfig.tools = [{ functionDeclarations: tools }]
			requestConfig.toolConfig = {
				// Force the model to call 'any' function.
				functionCallingConfig: {
					mode: FunctionCallingConfigMode.ANY,
				},
			}
		}

		try {
			const result = await client.models.generateContentStream({
				model: modelId,
				contents: contents,
				config: {
					...requestConfig,
				},
			})

			let isFirstSdkChunk = true
			for await (const chunk of result) {
				if (isFirstSdkChunk) {
					sdkFirstChunkTime = Date.now()
					ttftSdkMs = sdkFirstChunkTime - sdkCallStartTime
					isFirstSdkChunk = false
				}

				// Handle thinking content from Gemini's response
				const parts = chunk?.candidates?.[0]?.content?.parts || []
				for (const part of parts) {
					if (part.thought && part.text) {
						yield {
							type: "reasoning",
							id: chunk.responseId,
							reasoning: part.text || "",
							signature: part.thoughtSignature,
						}
					} else if (part.text) {
						yield {
							type: "text",
							text: part.text,
							id: chunk.responseId,
							signature: part.thoughtSignature,
						}
					}
					if (part.functionCall) {
						const functionCall = part.functionCall
						const args = Object.entries(functionCall.args || {}).filter(([_key, val]) => !!val)
						if (functionCall.args && args.length > 0) {
							yield {
								type: "tool_calls",
								id: chunk.responseId,
								tool_call: {
									function: {
										id: chunk.responseId,
										name: functionCall.name,
										arguments: JSON.stringify(functionCall.args),
									},
								},
								signature: part.thoughtSignature,
							}
						}
					}
				}

				if (chunk.usageMetadata) {
					responseId = chunk.responseId
					lastUsageMetadata = chunk.usageMetadata
					promptTokens = lastUsageMetadata.promptTokenCount ?? promptTokens
					outputTokens = lastUsageMetadata.candidatesTokenCount ?? outputTokens
					thoughtsTokenCount = lastUsageMetadata.thoughtsTokenCount ?? thoughtsTokenCount
					cacheReadTokens = lastUsageMetadata.cachedContentTokenCount ?? cacheReadTokens
				}
			}
			apiSuccess = true

			if (lastUsageMetadata) {
				const totalCost = this.calculateCost({
					info,
					inputTokens: promptTokens,
					outputTokens,
					thoughtsTokenCount,
					cacheReadTokens,
				})
				yield {
					type: "usage",
					inputTokens: promptTokens - cacheReadTokens,
					outputTokens,
					thoughtsTokenCount,
					cacheReadTokens,
					cacheWriteTokens: 0,
					totalCost,
					id: responseId,
				}
			}
		} catch (error) {
			apiSuccess = false
			// Let the error propagate to be handled by withRetry or Task.ts
			// Telemetry will be sent in the finally block.
			if (error instanceof Error) {
				apiError = error.message

				if (error instanceof ApiError) {
					if (error.status === 429) {
						// The API includes more details in the message
						// https://github.com/googleapis/js-genai/blob/v1.11.0/src/_api_client.ts#L758
						const response = this.attemptParse(error.message)

						if (response?.error) {
							// If the message is a stringified JSON, attempt to parse it
							const responseBody =
								typeof response.error.message === "string" &&
								(response.error.message.startsWith("{") || response.error.message.startsWith("["))
									? this.attemptParse(response.error.message)
									: response.error

							if (responseBody?.error?.details || responseBody?.details) {
								const details = responseBody.error?.details || responseBody.details
								const detail = details.find(
									(d: { "@type": string; retryDelay?: string }) =>
										d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
								)

								const detailedError = new RetriableError(
									apiError,
									this.parseRetryDelay(detail?.retryDelay) || undefined,
									{
										cause: error,
									},
								)
								throw detailedError
							}
						}

						throw new RetriableError(apiError, undefined, { cause: error })
					}

					// Fallback in case Gemini throws a rate limit error without a 429 status code
					// https://github.com/codemarie/codemarie/pull/5205#discussion_r2311761559
					const isRateLimit = rateLimitPatterns.some((pattern) => pattern.test(error.message))
					if (isRateLimit) {
						throw new RetriableError(apiError, undefined, { cause: error })
					}
				}
			} else {
				apiError = String(error)
			}

			throw error
		} finally {
			const sdkCallEndTime = Date.now()
			const totalDurationSdkMs = sdkCallEndTime - sdkCallStartTime
			const cacheHit = cacheReadTokens > 0
			const cacheHitPercentage = promptTokens > 0 ? (cacheReadTokens / promptTokens) * 100 : undefined
			const throughputTokensPerSecSdk =
				totalDurationSdkMs > 0 && outputTokens > 0 ? outputTokens / (totalDurationSdkMs / 1000) : undefined

			if (this.options.ulid) {
				telemetryService.captureGeminiApiPerformance(this.options.ulid, modelId, {
					ttftSec: ttftSdkMs !== undefined ? ttftSdkMs / 1000 : undefined,
					totalDurationSec: totalDurationSdkMs / 1000,
					promptTokens,
					outputTokens,
					thoughtsTokenCount,
					cacheReadTokens,
					cacheHit,
					cacheHitPercentage,
					apiSuccess,
					apiError,
					throughputTokensPerSec: throughputTokensPerSecSdk,
					thinkingBudget,
					thinkingLevel: thinkingLevel?.toString(),
				})
			} else {
				Logger.warn("GeminiHandler: ulid not available for telemetry in createMessage.")
			}
		}
	}

	/**
	 * Calculate the immediate dollar cost of the API call based on token usage and model pricing.
	 *
	 * This method accounts for the immediate costs of the API call:
	 * - Input token costs (for uncached tokens)
	 * - Output token costs
	 * - Cache read costs
	 * - Gemini implicit caching has no write costs
	 *
	 */
	public calculateCost({
		info,
		inputTokens,
		outputTokens,
		thoughtsTokenCount = 0,
		cacheReadTokens = 0,
	}: {
		info: ModelInfo
		inputTokens: number
		outputTokens: number
		thoughtsTokenCount: number
		cacheReadTokens?: number
	}) {
		// Exit early if any required pricing information is missing
		if (!info.inputPrice || !info.outputPrice) {
			return undefined
		}

		let inputPrice = info.inputPrice
		let outputPrice = info.outputPrice
		const thinkingPrice = info.thinkingConfig?.outputPrice ?? outputPrice
		// Right now, we only show the immediate costs of caching and not the ongoing costs of storing the cache
		let cacheReadsPrice = info.cacheReadsPrice ?? 0

		// If there's tiered pricing then adjust prices based on the input tokens used
		if (info.tiers) {
			const tier = info.tiers.find((tier) => inputTokens <= tier.contextWindow)
			if (tier) {
				inputPrice = tier.inputPrice ?? inputPrice
				outputPrice = tier.outputPrice ?? outputPrice
				cacheReadsPrice = tier.cacheReadsPrice ?? cacheReadsPrice
			}
		}

		// Subtract the cached input tokens from the total input tokens
		const uncachedInputTokens = inputTokens - (cacheReadTokens ?? 0)

		// Calculate immediate costs only

		// 1. Input token costs (for uncached tokens)
		const inputTokensCost = inputPrice * (uncachedInputTokens / 1_000_000)

		// 2. Output token costs (separate regular output from reasoning tokens)
		const candidatesTokensCost = outputPrice * (outputTokens / 1_000_000)
		const thinkingTokensCost = thinkingPrice * (thoughtsTokenCount / 1_000_000)
		const totalResponseTokensCost = candidatesTokensCost + thinkingTokensCost

		// 3. Cache read costs (immediate)
		const cacheReadCost = (cacheReadTokens ?? 0) > 0 ? cacheReadsPrice * ((cacheReadTokens ?? 0) / 1_000_000) : 0

		// Calculate total immediate cost (excluding cache write/storage costs)
		const totalCost = inputTokensCost + totalResponseTokensCost + cacheReadCost

		// Create the trace object for debugging
		const trace: Record<string, { price: number; tokens: number; cost: number }> = {
			input: { price: inputPrice, tokens: uncachedInputTokens, cost: inputTokensCost },
			output: { price: outputPrice, tokens: outputTokens, cost: candidatesTokensCost },
		}

		if (thoughtsTokenCount > 0) {
			trace.thinking = { price: thinkingPrice, tokens: thoughtsTokenCount, cost: thinkingTokensCost }
		}

		// Only include cache read costs in the trace (cache write costs are tracked separately)
		if ((cacheReadTokens ?? 0) > 0) {
			trace.cacheRead = { price: cacheReadsPrice, tokens: cacheReadTokens ?? 0, cost: cacheReadCost }
		}

		// Logger.log(`[GeminiHandler] calculateCost -> ${totalCost}`, trace)
		return totalCost
	}

	/**
	 * Get the model ID and info for the current configuration
	 */
	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return {
			id: geminiDefaultModelId,
			info: geminiModels[geminiDefaultModelId],
		}
	}

	/**
	 * Generates embeddings for a single text string.
	 */
	async embedText(text: string): Promise<number[] | null> {
		if (!text.trim()) return null
		const client = this.ensureClient()
		const modelId = "gemini-embedding-2-preview"

		try {
			const response = await client.models.embedContent({
				model: modelId,
				contents: [{ parts: [{ text }] }],
			})

			if (response.embeddings && response.embeddings.length > 0) {
				return response.embeddings[0].values || null
			}
			return null
		} catch (error) {
			Logger.warn(`Gemini embedText error: ${error instanceof Error ? error.message : String(error)}`)
			return null
		}
	}

	/**
	 * Summarizes a text string using the Gemini model.
	 */
	async summarizeText(text: string): Promise<string> {
		if (!text.trim()) return ""
		const client = this.ensureClient()
		const { id } = this.getModel()

		try {
			const prompt = `Summarize the following cognitive memory history into a concise, high-value representation. Focus on key decisions, technical patterns, and progress milestones:
\n\n${text}`

			const result = await client.models.generateContent({
				model: id,
				contents: [{ role: "user", parts: [{ text: prompt }] }],
			})

			return result.candidates?.[0]?.content?.parts?.[0]?.text || ""
		} catch (error) {
			Logger.warn(`Gemini summarizeText error: ${error instanceof Error ? error.message : String(error)}`)
			return text.substring(0, 1000) // Fallback to truncation
		}
	}

	/**
	 * Generates embeddings for multiple text strings in a batch.
	 */
	async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
		if (texts.length === 0) return []
		const client = this.ensureClient()
		const modelId = "gemini-embedding-2-preview"

		try {
			const response = await client.models.embedContent({
				model: modelId,
				contents: texts.map((text) => ({ parts: [{ text }] })),
			})

			if (response.embeddings) {
				return response.embeddings.map((e) => e.values || null)
			}
			return texts.map(() => null)
		} catch (error) {
			Logger.warn(`Gemini embedBatch error: ${error instanceof Error ? error.message : String(error)}`)
			return texts.map(() => null)
		}
	}

	/**
	 * Count tokens in content using the Gemini API
	 */
	async countTokens(content: Array<any>): Promise<number> {
		try {
			const client = this.ensureClient()
			const { id: model } = this.getModel()

			// Convert content to Gemini format
			const geminiContent = content.map((block) => {
				if (typeof block === "string") {
					return { text: block }
				}
				return { text: JSON.stringify(block) }
			})

			// Use Gemini's token counting API
			const response = await client.models.countTokens({
				model,
				contents: [{ parts: geminiContent }],
			})

			if (response.totalTokens === undefined) {
				Logger.warn("Gemini token counting returned undefined, using fallback")
				return this.estimateTokens(content)
			}

			return response.totalTokens
		} catch (error) {
			Logger.warn("Gemini token counting failed, using fallback", error)
			return this.estimateTokens(content)
		}
	}

	/**
	 * Fallback token estimation method
	 */
	private estimateTokens(content: Array<any>): number {
		// Simple estimation: ~4 characters per token
		const totalChars = content.reduce((total, block) => {
			if (typeof block === "string") {
				return total + block.length
			}
			if (block && typeof block === "object") {
				// Safely stringify the object
				try {
					const jsonStr = JSON.stringify(block)
					return total + jsonStr.length
				} catch (e) {
					Logger.warn("Failed to stringify block for token estimation", e)
					return total
				}
			}
			return total
		}, 0)

		return Math.ceil(totalChars / 4)
	}

	private parseRetryDelay(retryAfter?: string): number {
		if (!retryAfter) {
			return 0
		}

		const unit = retryAfter.at(-1)
		const value = Number.parseInt(retryAfter, 10)

		if (Number.isNaN(value)) {
			return 0
		}

		if (unit === "s") {
			return value
		}
		if (unit === "m") {
			return value * 60 // Convert minutes to seconds
		}
		if (unit === "h") {
			return value * 60 * 60 // Convert hours to seconds
		}

		return value
	}

	private attemptParse(str: string) {
		try {
			return JSON.parse(str)
		} catch (_) {
			return null
		}
	}
}
