import Cerebras from "@cerebras/cerebras_cloud_sdk"
import { CerebrasModelId, cerebrasDefaultModelId, cerebrasModels, ModelInfo } from "@shared/api"
import type OpenAI from "openai"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { DietCodeTool } from "@/shared/tools"
import { RetriableError, withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { ApiHandler, CommonApiHandlerOptions } from "../types"

interface CerebrasHandlerOptions extends CommonApiHandlerOptions {
	cerebrasApiKey?: string
	apiModelId?: string
}

type OpenAIMessageWithReasoning = OpenAI.Chat.ChatCompletionMessageParam & {
	reasoning?: unknown
	reasoning_content?: unknown
	reasoning_details?: unknown
}

type CerebrasMessages = NonNullable<Cerebras.ChatCompletionCreateParams["messages"]>
type CerebrasTools = NonNullable<Cerebras.ChatCompletionCreateParams["tools"]>

interface CerebrasApiError {
	status?: number
	code?: string
	message?: string
}

interface CerebrasStreamChunk {
	choices?: Array<{
		delta?: {
			content?: string | null
			reasoning?: string | null
			tool_calls?: unknown
		} | null
	}>
	usage?: {
		prompt_tokens?: number
		completion_tokens?: number
		prompt_tokens_details?: {
			cached_tokens?: number
		} | null
	}
}

// Cerebras accounts for max_completion_tokens when enforcing token rate limits.
// A conservative default leaves headroom for successive agent tool turns.
const CEREBRAS_DEFAULT_MAX_TOKENS = 16_384

function stripThinkingTags(content: string): string {
	return content
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/<think>[\s\S]*$/gi, "")
		.trim()
}

/**
 * Cerebras rejects reasoning history on follow-up requests. Convert the stored
 * conversation to OpenAI-compatible messages, remove private reasoning fields,
 * and omit assistant messages that contained reasoning only.
 */
export function prepareCerebrasMessages(messages: DietCodeStorageMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
	const prepared: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const message of convertToOpenAiMessages(messages, "cerebras")) {
		const sanitized = { ...message } as OpenAIMessageWithReasoning
		delete sanitized.reasoning
		delete sanitized.reasoning_content
		delete sanitized.reasoning_details

		if (sanitized.role !== "assistant") {
			prepared.push(sanitized)
			continue
		}

		if (typeof sanitized.content === "string") {
			sanitized.content = stripThinkingTags(sanitized.content)
		}

		const hasContent =
			(typeof sanitized.content === "string" && sanitized.content.trim().length > 0) ||
			(Array.isArray(sanitized.content) && sanitized.content.length > 0)
		const hasToolCalls = Array.isArray(sanitized.tool_calls) && sanitized.tool_calls.length > 0

		if (hasContent || hasToolCalls) {
			prepared.push(sanitized)
		}
	}

	return prepared
}

function splitLegacyThinkingChunk(
	content: string,
	startedInReasoning: boolean,
): { reasoning: string; text: string; inReasoning: boolean } {
	let rest = content
	let inReasoning = startedInReasoning
	let reasoning = ""
	let text = ""

	while (rest.length > 0) {
		if (inReasoning) {
			const closeIndex = rest.indexOf("</think>")
			if (closeIndex === -1) {
				reasoning += rest
				break
			}
			reasoning += rest.slice(0, closeIndex)
			rest = rest.slice(closeIndex + "</think>".length)
			inReasoning = false
		} else {
			const openIndex = rest.indexOf("<think>")
			if (openIndex === -1) {
				text += rest
				break
			}
			text += rest.slice(0, openIndex)
			rest = rest.slice(openIndex + "<think>".length)
			inReasoning = true
		}
	}

	return { reasoning, text, inReasoning }
}

export class CerebrasHandler implements ApiHandler {
	private options: CerebrasHandlerOptions
	private client: Cerebras | undefined

	constructor(options: CerebrasHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Cerebras {
		if (!this.client) {
			const cleanApiKey = this.options.cerebrasApiKey?.trim()
			if (!cleanApiKey) {
				throw new Error("Cerebras API key is required")
			}

			try {
				this.client = new Cerebras({
					apiKey: cleanApiKey,
					timeout: 30_000,
					maxRetries: 0,
					warmTCPConnection: false,
					fetch,
					defaultHeaders: {
						...buildExternalBasicHeaders(),
						"X-Cerebras-3rd-Party-Integration": "dietcode",
					},
				})
			} catch (error) {
				throw new Error(`Error creating Cerebras client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry({
		maxRetries: 6,
		baseDelay: 5_000,
		maxDelay: 60_000,
	})
	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[], tools?: DietCodeTool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const cerebrasMessages = [{ role: "system" as const, content: systemPrompt }, ...prepareCerebrasMessages(messages)]

		try {
			const stream = await client.chat.completions.create({
				model: model.id,
				messages: cerebrasMessages as unknown as CerebrasMessages,
				temperature: model.info.temperature ?? 0,
				stream: true,
				stream_options: { include_usage: true },
				max_completion_tokens: CEREBRAS_DEFAULT_MAX_TOKENS,
				tools: tools?.length ? (tools as unknown as CerebrasTools) : undefined,
				tool_choice: tools?.length ? "auto" : undefined,
				parallel_tool_calls: false,
			})

			const toolCallProcessor = new ToolCallProcessor()
			let inLegacyReasoning = false

			for await (const chunk of stream) {
				const streamChunk = chunk as unknown as CerebrasStreamChunk
				const delta = streamChunk.choices?.[0]?.delta
				if (delta?.reasoning) {
					yield {
						type: "reasoning",
						reasoning: delta.reasoning,
					}
				}

				if (delta?.content) {
					const parsed = splitLegacyThinkingChunk(delta.content, inLegacyReasoning)
					inLegacyReasoning = parsed.inReasoning

					if (parsed.reasoning) {
						yield {
							type: "reasoning",
							reasoning: parsed.reasoning,
						}
					}
					if (parsed.text) {
						yield {
							type: "text",
							text: parsed.text,
						}
					}
				}

				if (delta?.tool_calls) {
					yield* toolCallProcessor.processToolCallDeltas(
						delta.tool_calls as unknown as OpenAI.Chat.ChatCompletionChunk.Choice.Delta.ToolCall[],
					)
				}

				if (streamChunk.usage) {
					const cacheReadTokens = streamChunk.usage.prompt_tokens_details?.cached_tokens || 0
					const inputTokens = Math.max(0, (streamChunk.usage.prompt_tokens || 0) - cacheReadTokens)
					const outputTokens = streamChunk.usage.completion_tokens || 0

					yield {
						type: "usage",
						inputTokens,
						outputTokens,
						cacheReadTokens,
						cacheWriteTokens: 0,
						totalCost: this.calculateCost({ inputTokens, outputTokens, cacheReadTokens }),
					}
				}
			}
		} catch (error) {
			const apiError = (typeof error === "object" && error !== null ? error : {}) as CerebrasApiError
			if (apiError.status === 429 || apiError.code === "rate_limit_exceeded") {
				throw new RetriableError("Cerebras API rate limit exceeded.", undefined, { cause: error })
			}
			if (apiError.status === 401) {
				throw new Error("Cerebras API authentication failed. Please check your API key.", { cause: error })
			}
			if (apiError.status === 403) {
				throw new Error("Cerebras API access denied. Please check your API key permissions.", { cause: error })
			}
			if (apiError.status !== undefined && apiError.status >= 500) {
				throw new Error(`Cerebras API server error (${apiError.status}): ${apiError.message || "Unknown server error"}`, {
					cause: error,
				})
			}
			if (apiError.status === 400) {
				throw new Error(`Cerebras API bad request: ${apiError.message || "Invalid request parameters"}`, {
					cause: error,
				})
			}
			throw error
		}
	}

	getModel(): { id: CerebrasModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in cerebrasModels) {
			const id = modelId as CerebrasModelId
			return { id, info: cerebrasModels[id] }
		}
		return {
			id: cerebrasDefaultModelId,
			info: cerebrasModels[cerebrasDefaultModelId],
		}
	}

	private calculateCost({
		inputTokens,
		outputTokens,
		cacheReadTokens,
	}: {
		inputTokens: number
		outputTokens: number
		cacheReadTokens: number
	}): number {
		const info = this.getModel().info
		const inputCost = ((info.inputPrice || 0) / 1_000_000) * inputTokens
		const outputCost = ((info.outputPrice || 0) / 1_000_000) * outputTokens
		const cacheReadCost = ((info.cacheReadsPrice ?? info.inputPrice ?? 0) / 1_000_000) * cacheReadTokens
		return inputCost + outputCost + cacheReadCost
	}
}
