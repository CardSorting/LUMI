import { geminiDefaultModelId, geminiModels, ModelInfo } from "@shared/api"
import { AuthService } from "@/services/auth/AuthService"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

export interface GooglePersonalHandlerOptions extends CommonApiHandlerOptions {
	apiModelId?: string
}

export class GooglePersonalHandler implements ApiHandler {
	private options: GooglePersonalHandlerOptions
	private abortController?: AbortController

	constructor(options: GooglePersonalHandlerOptions) {
		this.options = options
	}

	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[]): ApiStream {
		this.abortController = new AbortController()
		const token = await AuthService.getInstance().getAuthToken("google")
		if (!token) {
			throw new Error("Google Personal provider requires you to be signed in with Google.")
		}

		const { id: modelId, info } = this.getModel()
		const contents = messages.map((msg) => convertAnthropicMessageToGemini(msg, modelId))

		const request = {
			model: modelId,
			request: {
				contents,
				systemInstruction: {
					role: "user",
					parts: [{ text: systemPrompt }],
				},
				generationConfig: {
					temperature: info.temperature ?? 1,
				},
			},
		}

		const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`
		const headers = {
			...buildExternalBasicHeaders(),
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		}

		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(request),
			signal: this.abortController.signal,
		})

		if (!response.ok) {
			let errorDetail = await response.text()
			try {
				const errorJson = JSON.parse(errorDetail)
				errorDetail = errorJson.error?.message || errorJson.message || errorDetail
			} catch {
				// Fallback to raw text
			}
			throw new Error(`Google Personal API error (${response.status}): ${errorDetail}`)
		}

		if (!response.body) {
			throw new Error("No response body received from Google Personal API")
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		try {
			while (true) {
				// Check for signal before reading
				if (this.abortController.signal.aborted) {
					await reader.cancel()
					break
				}

				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })

				const lineBreakIndex: number = buffer.indexOf("\n")
				while (lineBreakIndex !== -1) {
					const line = buffer.slice(0, lineBreakIndex).trim()
					buffer = buffer.slice(lineBreakIndex + 1)

					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (!data) continue

						try {
							const json = JSON.parse(data)
							const vertexResponse = json.response
							if (vertexResponse) {
								const parts = vertexResponse.candidates?.[0]?.content?.parts || []
								for (const part of parts) {
									if (part.text) {
										yield {
											type: "text",
											text: part.text,
											id: json.traceId,
										}
									}
								}

								if (vertexResponse.usageMetadata) {
									const usage = vertexResponse.usageMetadata
									yield {
										type: "usage",
										inputTokens: usage.promptTokenCount ?? 0,
										outputTokens: usage.candidatesTokenCount ?? 0,
										totalCost: 0, // Free tier
									}
								}
							}
						} catch (e) {
							Logger.error("Failed to parse Google Personal API response chunk", e)
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			return { id: modelId, info: (geminiModels as Record<string, any>)[modelId] }
		}
		return {
			id: geminiDefaultModelId,
			info: (geminiModels as Record<string, any>)[geminiDefaultModelId],
		}
	}

	abort() {
		if (this.abortController) {
			this.abortController.abort()
		}
	}
}
