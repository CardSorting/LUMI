import { ModelInfo, OpenAiCodexModelId, openAiCodexDefaultModelId, openAiCodexModels } from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ResponseInput, ResponseStreamEvent, ResponseUsage } from "openai/resources/responses/responses"
import * as os from "os"
import { MessageEvent as UndiciMessageEvent, WebSocket as UndiciWebSocket } from "undici"
import { v7 as uuidv7 } from "uuid"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/dietcode/models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"

/**
 * OpenAI Codex base URL for API requests
 * Routes to chatgpt.com/backend-api/codex
 */
const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex"
const CODEX_RESPONSES_WEBSOCKET_URL = "wss://chatgpt.com/backend-api/codex/responses"

interface OpenAiCodexHandlerOptions extends CommonApiHandlerOptions {
	reasoningEffort?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

/**
 * OpenAiCodexHandler - Uses OpenAI Responses API with OAuth authentication
 *
 * Key differences from OpenAiNativeHandler:
 * - Uses OAuth Bearer tokens instead of API keys
 * - Routes requests to Codex backend (chatgpt.com/backend-api/codex)
 * - Subscription-based pricing (no per-token costs)
 * - Limited model subset
 * - Custom headers for Codex backend
 */
export class OpenAiCodexHandler implements ApiHandler {
	private options: OpenAiCodexHandlerOptions
	private client?: OpenAI
	private responsesWs: UndiciWebSocket | undefined
	private websocketRequestInFlight = false
	// Session ID for the Codex API (persists for the lifetime of the handler)
	private readonly sessionId: string
	// Abort controller for cancelling ongoing requests
	private abortController?: AbortController
	// Track tool call identity for streaming
	private pendingToolCallId: string | undefined
	private pendingToolCallName: string | undefined
	private lastResponseId: string | undefined
	private functionCallByItemId = new Map<string, { call_id?: string; name?: string; id?: string }>()

	constructor(options: OpenAiCodexHandlerOptions) {
		this.options = options
		this.sessionId = uuidv7()
	}

	private normalizeUsage(
		usage: ResponseUsage | undefined,
		_model: { id: string; info: ModelInfo },
	): ApiStreamUsageChunk | undefined {
		if (!usage) {
			return undefined
		}

		const totalInputTokens = usage.input_tokens || 0
		const totalOutputTokens = usage.output_tokens || 0
		const cachedTokens = usage.input_tokens_details?.cached_tokens || 0
		const reasoningTokens = usage.output_tokens_details?.reasoning_tokens

		// Subscription-based: no per-token costs
		const out: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheWriteTokens: 0, // Not explicitly provided in this SDK version
			cacheReadTokens: cachedTokens,
			...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
			totalCost: 0, // Subscription-based pricing
		}
		return out
	}

	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const model = this.getModel()

		// Reset state for this request
		this.pendingToolCallId = undefined
		this.pendingToolCallName = undefined
		this.functionCallByItemId.clear()

		// Get access token from OAuth manager
		let accessToken = await openAiCodexOAuthManager.getAccessToken()
		if (!accessToken) {
			throw new Error("Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow in settings.")
		}
		const useWebsocketMode = this.useWebsocketMode(model.info.apiFormat)
		const { input, previousResponseId } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId: true })

		// Build request body
		const requestBody = this.buildRequestBody(model, input, systemPrompt, tools, previousResponseId)
		const fallbackRequestBody = this.buildRequestBody(model, input, systemPrompt, tools)

		// Make the request with retry on auth failure
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				yield* this.executeRequest(requestBody, fallbackRequestBody, model, accessToken, useWebsocketMode)
				return
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const isAuthFailure = /unauthorized|invalid token|not authenticated|authentication|401/i.test(message)

				if (attempt === 0 && isAuthFailure) {
					// Force refresh the token for retry
					const refreshed = await openAiCodexOAuthManager.forceRefreshAccessToken()
					if (!refreshed) {
						throw new Error(
							"Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow in settings.",
						)
					}
					accessToken = refreshed
					continue
				}
				throw error
			}
		}
	}

	private useWebsocketMode(apiFormat?: ApiFormat): boolean {
		if (featureFlagsService.getBooleanFlagEnabled(FeatureFlag.OPENAI_RESPONSES_WEBSOCKET_MODE)) {
			return apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
		}
		return false
	}

	private buildRequestBody(
		model: { id: string; info: ModelInfo },
		formattedInput: ResponseInput,
		systemPrompt: string,
		tools?: ChatCompletionTool[],
		previousResponseId?: string,
	): OpenAI.Responses.ResponseCreateParamsStreaming {
		// Determine reasoning effort
		const reasoningEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const includeReasoning = reasoningEffort !== "none"

		const body: OpenAI.Responses.ResponseCreateParamsStreaming = {
			model: model.id,
			input: formattedInput,
			stream: true,
			store: !previousResponseId,
			instructions: systemPrompt,
			...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
			...(includeReasoning
				? {
						reasoning: {
							effort: reasoningEffort,
							summary: "auto",
						},
					}
				: {}),
		}

		// Add tools if provided
		// Pass through strict value from tool (MCP/custom tools have strict: false, built-in tools default to true)
		if (tools && tools.length > 0) {
			body.tools = tools
				.filter((tool) => tool?.type === "function")
				.map((tool) => ({
					type: "function",
					name: tool.function.name,
					description: tool.function.description,
					parameters: tool.function.parameters ?? null,
					strict: tool.function.strict ?? true,
				}))
		}

		return body
	}

	private async *executeRequest(
		requestBody: OpenAI.Responses.ResponseCreateParamsStreaming,
		fallbackRequestBody: OpenAI.Responses.ResponseCreateParamsStreaming,
		model: { id: string; info: ModelInfo },
		accessToken: string,
		useWebsocketMode: boolean,
	): ApiStream {
		// Create AbortController for cancellation
		this.abortController = new AbortController()

		try {
			// Get ChatGPT account ID for organization subscriptions
			const accountId = await openAiCodexOAuthManager.getAccountId()

			// Build Codex-specific headers
			const codexHeaders: Record<string, string> = {
				originator: "dietcode",
				session_id: this.sessionId,
				"User-Agent": `dietcode/${process.env.npm_package_version || "1.0.0"} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`,
				...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
				...buildExternalBasicHeaders(),
			}

			if (useWebsocketMode) {
				try {
					yield* this.createResponseStreamWebsocket(requestBody, fallbackRequestBody, accessToken, codexHeaders, model)
					return
				} catch (error) {
					Logger.error("OpenAI Codex websocket mode failed, falling back to HTTP Responses API:", error)
					this.closeResponsesWebsocket()
				}
			}

			try {
				yield* this.createResponseStreamWithRetry(requestBody, fallbackRequestBody, accessToken, codexHeaders, model)
			} catch {
				// Final fallback to manual SSE if SDK fails completely
				yield* this.makeCodexRequest(requestBody, model, accessToken)
			}
		} finally {
			this.abortController = undefined
		}
	}

	private async *createResponseStreamWithRetry(
		primaryRequestBody: OpenAI.Responses.ResponseCreateParamsStreaming,
		fallbackRequestBody: OpenAI.Responses.ResponseCreateParamsStreaming,
		accessToken: string,
		codexHeaders: Record<string, string>,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		try {
			yield* this.createResponseStreamWithSdk(primaryRequestBody, accessToken, codexHeaders, model)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const isSessionNotFound = errorMessage.includes("previous_response_not_found") || errorMessage.includes("404")

			if (isSessionNotFound && !!primaryRequestBody.previous_response_id) {
				Logger.log("Retrying Codex SDK response with full context after previous_response_not_found")
				yield* this.createResponseStreamWithSdk(fallbackRequestBody, accessToken, codexHeaders, model)
				return
			}
			throw error
		}
	}

	private async *createResponseStreamWithSdk(
		requestBody: OpenAI.Responses.ResponseCreateParamsStreaming,
		accessToken: string,
		codexHeaders: Record<string, string>,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		const client =
			this.client ??
			new OpenAI({
				apiKey: accessToken,
				baseURL: CODEX_API_BASE_URL,
				defaultHeaders: codexHeaders,
				fetch, // Use shared fetch for proxy support
			})

		const stream = (await (client as any).responses.create(requestBody, {
			signal: this.abortController?.signal,
			headers: codexHeaders,
		})) as AsyncIterable<ResponseStreamEvent>

		if (typeof (stream as any)?.[Symbol.asyncIterator] !== "function") {
			throw new Error("OpenAI SDK did not return an AsyncIterable")
		}

		for await (const event of stream) {
			if (this.abortController?.signal.aborted) {
				break
			}

			const eventAny = event as any
			if (eventAny.id) {
				this.lastResponseId = eventAny.id
			} else if (eventAny.response_id) {
				this.lastResponseId = eventAny.response_id
			}

			yield* this.processEvent(event, model, this.lastResponseId)
		}
	}

	private async *createResponseStreamWebsocket(
		primaryParams: OpenAI.Responses.ResponseCreateParamsStreaming,
		fallbackParams: OpenAI.Responses.ResponseCreateParamsStreaming,
		accessToken: string,
		codexHeaders: Record<string, string>,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		try {
			for await (const event of this.createResponseEventsViaWebsocket(primaryParams, accessToken, codexHeaders)) {
				if (this.abortController?.signal.aborted) {
					return
				}
				const eventAny = event as any
				if (eventAny.id) {
					this.lastResponseId = eventAny.id
				} else if (eventAny.response_id) {
					this.lastResponseId = eventAny.response_id
				}
				yield* this.processEvent(event, model, this.lastResponseId)
			}
		} catch (error) {
			if (this.shouldRetryWebsocketWithFullContext(error, !!primaryParams.previous_response_id)) {
				Logger.log(
					"Retrying Codex websocket response with full context after previous_response_not_found or socket reset",
				)
				this.closeResponsesWebsocket()
				for await (const event of this.createResponseEventsViaWebsocket(fallbackParams, accessToken, codexHeaders)) {
					if (this.abortController?.signal.aborted) {
						return
					}
					const eventAny = event as any
					if (eventAny.id) {
						this.lastResponseId = eventAny.id
					} else if (eventAny.response_id) {
						this.lastResponseId = eventAny.response_id
					}
					yield* this.processEvent(event, model, this.lastResponseId)
				}
				return
			}
			throw error
		}
	}

	private shouldRetryWebsocketWithFullContext(error: unknown, hadPreviousResponseId: boolean): boolean {
		const errorCode =
			typeof error === "object" && error && "code" in error && typeof (error as { code: unknown }).code === "string"
				? (error as { code: string }).code
				: undefined

		if (hadPreviousResponseId && errorCode === "previous_response_not_found") {
			return true
		}
		if (errorCode === "websocket_closed" || errorCode === "websocket_error") {
			return true
		}
		return false
	}

	private async ensureResponsesWebsocket(accessToken: string, codexHeaders: Record<string, string>): Promise<UndiciWebSocket> {
		if (this.responsesWs && this.responsesWs.readyState === UndiciWebSocket.OPEN) {
			return this.responsesWs
		}

		this.closeResponsesWebsocket()

		const ws = new UndiciWebSocket(CODEX_RESPONSES_WEBSOCKET_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"OpenAI-Beta": "responses_websockets=2026-02-06",
				...codexHeaders,
			},
		})

		const connectionTimeout = setTimeout(() => {
			ws.close()
		}, 10000)

		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(connectionTimeout)
				ws.removeEventListener("open", handleOpen)
				ws.removeEventListener("error", handleError)
				ws.removeEventListener("close", handleClose)
			}
			const handleOpen = () => {
				cleanup()
				resolve()
			}
			const handleError = () => {
				cleanup()
				reject(new Error("Failed to connect to Codex Responses websocket (connection error)"))
			}
			const handleClose = () => {
				cleanup()
				reject(new Error("Codex Responses websocket closed during connection handshake"))
			}
			ws.addEventListener("open", handleOpen)
			ws.addEventListener("error", handleError)
			ws.addEventListener("close", handleClose)
		})

		this.responsesWs = ws
		return ws
	}

	private closeResponsesWebsocket() {
		if (this.responsesWs) {
			try {
				this.responsesWs.close()
			} catch {}
			this.responsesWs = undefined
		}
	}

	private async *createResponseEventsViaWebsocket(
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
		accessToken: string,
		codexHeaders: Record<string, string>,
	): AsyncGenerator<ResponseStreamEvent> {
		if (this.websocketRequestInFlight) {
			const error: Error & { code?: string } = new Error("Websocket response.create is already in progress")
			error.code = "websocket_concurrency_limit"
			throw error
		}

		const ws = await this.ensureResponsesWebsocket(accessToken, codexHeaders)
		this.websocketRequestInFlight = true

		const eventQueue: ResponseStreamEvent[] = []
		let resolver: (() => void) | undefined
		let completed = false
		let failure: (Error & { code?: string }) | undefined

		const wake = () => {
			const next = resolver
			resolver = undefined
			next?.()
		}

		const handleMessage = (evt: UndiciMessageEvent) => {
			try {
				let raw = ""
				if (typeof evt.data === "string") {
					raw = evt.data
				} else if (evt.data instanceof ArrayBuffer) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data))
				} else if (ArrayBuffer.isView(evt.data)) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data.buffer, evt.data.byteOffset, evt.data.byteLength))
				} else {
					raw = String(evt.data)
				}

				const parsed = JSON.parse(raw)
				if (parsed?.type === "error" && parsed?.error) {
					const error: Error & { code?: string } = new Error(parsed.error.message || "Codex Responses websocket error")
					error.code = parsed.error.code
					failure = error
					completed = true
					wake()
					return
				}

				eventQueue.push(parsed as ResponseStreamEvent)
				if (parsed?.type === "response.completed" || parsed?.type === "response.failed") {
					completed = true
				}
				wake()
			} catch (error) {
				const parseError: Error & { code?: string } = new Error(
					`Failed to parse websocket event: ${error instanceof Error ? error.message : String(error)}`,
				)
				parseError.code = "websocket_parse_error"
				failure = parseError
				completed = true
				wake()
			}
		}

		const handleError = () => {
			const error: Error & { code?: string } = new Error("Codex Responses websocket emitted an error event")
			error.code = "websocket_error"
			failure = error
			completed = true
			wake()
		}

		const handleClose = () => {
			if (!completed) {
				const error: Error & { code?: string } = new Error("Codex Responses websocket closed during response stream")
				error.code = "websocket_closed"
				failure = error
				completed = true
				wake()
			}
		}

		ws.addEventListener("message", handleMessage)
		ws.addEventListener("error", handleError)
		ws.addEventListener("close", handleClose)

		try {
			ws.send(
				JSON.stringify({
					type: "response.create",
					...params,
				}),
			)

			while (!completed || eventQueue.length > 0) {
				if (eventQueue.length === 0) {
					await new Promise<void>((resolve) => {
						resolver = resolve
					})
					continue
				}

				const event = eventQueue.shift()
				if (event) {
					yield event
				}
			}

			if (failure) {
				throw failure
			}
		} finally {
			ws.removeEventListener("message", handleMessage)
			ws.removeEventListener("error", handleError)
			ws.removeEventListener("close", handleClose)
			this.websocketRequestInFlight = false
		}
	}

	private async *makeCodexRequest(
		requestBody: OpenAI.Responses.ResponseCreateParamsStreaming,
		model: { id: string; info: ModelInfo },
		accessToken: string,
	): ApiStream {
		const url = `${CODEX_API_BASE_URL}/responses`

		// Get ChatGPT account ID for organization subscriptions
		const accountId = await openAiCodexOAuthManager.getAccountId()

		// Build headers with required Codex-specific fields
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
			originator: "dietcode",
			session_id: this.sessionId,
			"User-Agent": `dietcode/${process.env.npm_package_version || "1.0.0"} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`,
			...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
			...buildExternalBasicHeaders(),
		}

		try {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal: this.abortController?.signal,
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorMessage = `Codex API request failed: ${response.status}`

				// Log full error for diagnostics
				Logger.error("OpenAI Codex SSE Error Response:", {
					status: response.status,
					body: errorText,
					model: model.id,
					requestId: requestBody.previous_response_id,
				})

				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorMessage = errorJson.error.message
					} else if (errorJson.message) {
						errorMessage = errorJson.message
					}
				} catch {
					if (errorText) {
						errorMessage += ` - ${errorText}`
					}
				}

				// Check for session not found in SSE response
				if (errorMessage.includes("previous_response_not_found") || response.status === 404) {
					const error: Error & { code?: string } = new Error(errorMessage)
					error.code = "previous_response_not_found"
					throw error
				}

				throw new Error(errorMessage)
			}

			if (!response.body) {
				throw new Error("No response body from Codex API")
			}

			yield* this.handleStreamResponse(response.body, model)
		} catch (error) {
			if (error instanceof Error) {
				// Rethrow with more context if it's already a Codex error
				if (error.message.startsWith("Codex API")) throw error
				throw new Error(`Codex API connection error: ${error.message}`)
			}
			throw new Error("Unexpected error connecting to Codex API")
		}
	}

	private async *handleStreamResponse(body: ReadableStream<Uint8Array>, model: { id: string; info: ModelInfo }): ApiStream {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				let boundary = buffer.indexOf("\n")

				while (boundary !== -1) {
					const line = buffer.slice(0, boundary).trim()
					buffer = buffer.slice(boundary + 1)

					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							// End of stream
						} else {
							try {
								const parsed = JSON.parse(data)

								if (parsed.id) {
									this.lastResponseId = parsed.id
								} else if (parsed.response_id) {
									this.lastResponseId = parsed.response_id
								}

								yield* this.processEvent(parsed, model, this.lastResponseId)
							} catch (e) {
								Logger.error("Failed to parse Codex SSE data chunk:", e, data)
							}
						}
					}

					boundary = buffer.indexOf("\n")
				}

				if (this.abortController?.signal.aborted) break
			}
		} finally {
			reader.releaseLock()
		}
	}

	private async *processEvent(
		event: ResponseStreamEvent,
		model: { id: string; info: ModelInfo },
		responseId?: string,
	): ApiStream {
		// Handle text deltas
		if (event.type === "response.output_text.delta") {
			const deltaEvent = event as any // Cast to access delta
			if (deltaEvent.delta) {
				yield { type: "text", text: deltaEvent.delta, id: responseId }
			}
			return
		}

		// Handle reasoning deltas (direct)
		if (event.type === "response.reasoning_text.delta" || event.type === "response.reasoning_summary_text.delta") {
			const deltaEvent = event as any
			if (deltaEvent.delta) {
				yield { type: "reasoning", reasoning: deltaEvent.delta, id: responseId }
			}
			return
		}

		// Handle reasoning summary parts (extended)
		if (event?.type === "response.reasoning_summary_part.added") {
			yield {
				type: "reasoning",
				id: event.item_id || responseId,
				reasoning: event.part?.text || "",
			}
			return
		}

		if (event?.type === "response.reasoning_summary_part.done") {
			yield {
				type: "reasoning",
				id: event.item_id || responseId,
				details: event.part,
				reasoning: "",
			}
			return
		}

		// Handle refusal deltas
		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				yield { type: "text", text: `[Refusal] ${event.delta}`, id: responseId }
			}
			return
		}

		// Handle tool/function call deltas
		if (event.type === "response.function_call_arguments.delta") {
			const deltaEvent = event as any
			const itemId = deltaEvent.item_id || deltaEvent.id
			const pendingCall = itemId ? this.functionCallByItemId.get(itemId) : undefined

			const callId = deltaEvent.call_id || deltaEvent.tool_call_id || pendingCall?.call_id || this.pendingToolCallId
			const name = deltaEvent.name || deltaEvent.function_name || pendingCall?.name || this.pendingToolCallName
			const args = deltaEvent.delta || deltaEvent.arguments

			if (typeof callId === "string" && callId.length > 0) {
				yield {
					type: "tool_calls",
					id: responseId,
					tool_call: {
						call_id: callId,
						function: {
							id: itemId || callId,
							name: name || "",
							arguments: typeof args === "string" ? args : "",
						},
					},
				}
			}
			return
		}

		// Handle output item events
		if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
			const addedEvent = event as any
			const item = addedEvent.item
			if (item) {
				// Capture tool identity for subsequent argument deltas
				if (item.type === "function_call") {
					const callId = item.call_id || item.id
					const name = item.name || item.function_name
					if (typeof callId === "string" && callId.length > 0) {
						this.pendingToolCallId = callId
						this.pendingToolCallName = typeof name === "string" ? name : undefined
						if (item.id) {
							this.functionCallByItemId.set(item.id, {
								call_id: callId,
								name: this.pendingToolCallName,
								id: item.id,
							})
						}
					}
				}

				if (item.type === "message" && Array.isArray(item.content)) {
					for (const content of item.content) {
						if (content?.type === "output_text" && content?.text) {
							yield { type: "text", text: content.text, id: responseId }
						}
					}
				} else if (item.type === "reasoning" && item.text) {
					yield { type: "reasoning", reasoning: item.text, id: responseId }
				} else if (item.type === "reasoning" && item.encrypted_content) {
					yield {
						type: "reasoning",
						id: item.id || responseId,
						reasoning: "",
						redacted_data: item.encrypted_content,
					}
				} else if (item.type === "function_call" && event.type === "response.output_item.done") {
					const callId = item.call_id || item.id
					if (callId) {
						// NOTE: We do NOT yield the full arguments here because they have already been yielded as deltas.
						// Yielding them again would cause StreamResponseHandler to double-append them, corrupting the JSON.
						yield {
							type: "tool_calls",
							id: responseId,
							tool_call: {
								call_id: callId,
								function: {
									id: item.id || callId,
									name: item.name || item.function_name || "",
									arguments: "", // Arguments already streamed
								},
							},
						}
					}
				}
			}
			return
		}

		// Handle completion events
		if (event.type === "response.completed") {
			const completedEvent = event as any
			const usage = completedEvent.response?.usage || undefined
			const usageData = this.normalizeUsage(usage, model)
			if (usageData) {
				yield usageData
			}
			return
		}

		// Fallbacks for legacy formats
		const eventAny = event as any
		if (eventAny?.choices?.[0]?.delta?.content) {
			yield { type: "text", text: eventAny.choices[0].delta.content }
			return
		}

		if (eventAny?.usage) {
			const usageData = this.normalizeUsage(eventAny.usage, model)
			if (usageData) {
				yield usageData
			}
		}
	}

	abort(): void {
		this.closeResponsesWebsocket()
		this.abortController?.abort()
	}

	getModel(): { id: OpenAiCodexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		const id = modelId && modelId in openAiCodexModels ? (modelId as OpenAiCodexModelId) : openAiCodexDefaultModelId

		const info: ModelInfo = openAiCodexModels[id]

		return { id, info }
	}
}
