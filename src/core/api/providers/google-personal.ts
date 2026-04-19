import { geminiDefaultModelId, geminiModels, ModelInfo } from "@shared/api"
import { v4 as uuidv4 } from "uuid"
import { AuthService } from "@/services/auth/AuthService"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { telemetryService } from "@/services/telemetry"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { DietCodeTool } from "@/shared/tools"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

/**
 * Cloud Code Private API endpoint — same endpoint used by Gemini CLI.
 * Can be overridden via environment variable for staging/testing.
 */
const CODE_ASSIST_ENDPOINT = process.env.CODE_ASSIST_ENDPOINT || "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = process.env.CODE_ASSIST_API_VERSION || "v1internal"

/**
 * Maximum time to wait for LRO onboarding polling before giving up.
 */
const MAX_ONBOARDING_POLL_MS = 120_000 // 2 minutes
const ONBOARDING_POLL_INTERVAL_MS = 5_000 // 5 seconds (matching Gemini CLI's 5s interval)

/**
 * Maximum number of retry attempts for transient 500/503 errors on streamGenerateContent.
 */
const MAX_STREAM_RETRIES = 3
const STREAM_RETRY_DELAY_MS = 2_000

/**
 * Cached onboarding data from the Cloud Code API.
 */
interface OnboardingData {
	projectId: string
	tierId?: string
	tierName?: string
	cachedAt: number
}

/**
 * TTL for the onboarding cache.
 */
const ONBOARDING_CACHE_TTL_MS = 5 * 60 * 1000

// Module-level state for intelligent quota management
let cachedOnboardingData: OnboardingData | null = null

/**
 * Sovereign Quota Orchestrator (V19 Hardened)
 * Manages the high-fidelity state of rate limits, concurrency, and autonomous circuit breaking.
 */
class QuotaOrchestrator {
	private resetUntil = 0
	private activeCount = 0
	private readonly maxConcurrent = 1
	private backoffAttempt = 0
	private consecutiveErrors = 0
	private circuitBreakerTrippedUntil = 0

	private readonly MAX_CONSECUTIVE_ERRORS = 5
	private readonly CIRCUIT_BREAKER_DELAY_MS = 5 * 60 * 1000 // 5 minutes
	private readonly MAX_BACKOFF_MS = 60_000

	/**
	 * Blocks until the quota resets, concurrency slot is available, and circuit breaker is closed.
	 */
	async waitForClearance(signal: AbortSignal, onStatus?: (status: string) => void): Promise<void> {
		this.checkAborted(signal)

		// 1. Circuit Breaker Barrier
		if (Date.now() < this.circuitBreakerTrippedUntil) {
			const waitMs = this.circuitBreakerTrippedUntil - Date.now()
			const waitMin = Math.ceil(waitMs / 60000)
			Logger.error(`[QUOTA:BREAKER] Circuit is TRIPPED. Lockout active for ${waitMin}m.`)
			throw new Error(
				`Google Personal API is temporarily locked due to repeated failures. Please try again in ${waitMin} minutes.`,
			)
		}

		// 2. Quota Reset Barrier
		while (Date.now() < this.resetUntil) {
			const waitMs = this.resetUntil - Date.now()
			if (waitMs > 0) {
				const waitSec = Math.ceil(waitMs / 1000)
				Logger.info(`[QUOTA:RECOVERY] Barrier active. Waiting ${waitSec}s.`)
				onStatus?.(`Waiting for quota reset (${waitSec}s)...`)

				const sleepChunk = Math.min(waitMs, 500)
				await new Promise((resolve) => setTimeout(resolve, sleepChunk))
				this.checkAborted(signal)
			}
		}

		// 3. Concurrency Throttle
		while (this.activeCount >= this.maxConcurrent) {
			await new Promise((resolve) => setTimeout(resolve, 200))
			this.checkAborted(signal)
		}

		this.activeCount++
	}

	release(): void {
		this.activeCount = Math.max(0, this.activeCount - 1)
	}

	/**
	 * Records a rate-limit event or error and calculates the deterministic reset time.
	 */
	recordQuotaEvent(errorDetail: string, status: number, tierId?: string): number {
		this.consecutiveErrors++

		// V19 Hardening: Circuit Breaker Logic
		if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
			this.circuitBreakerTrippedUntil = Date.now() + this.CIRCUIT_BREAKER_DELAY_MS
			Logger.error(`[QUOTA:BREAKER] TRIPPING circuit after ${this.consecutiveErrors} consecutive errors.`)
		}

		const secondsMatch = errorDetail.match(/reset after (\d+)s/i)
		let waitMs: number

		if (secondsMatch) {
			waitMs = (Number.parseInt(secondsMatch[1], 10) + 1) * 1000
			this.backoffAttempt = 0
			Logger.warn(`[QUOTA] Explicit reset detected: ${waitMs}ms`)
		} else {
			this.backoffAttempt++
			// Tier-Adaptive Scaling: Free tier is much more sensitive
			const multiplier = tierId === "free-tier" ? 2.5 : 1.5
			const baseWait = status === 429 ? 5000 : 2000
			const exponentialWait = Math.min(baseWait * multiplier ** this.backoffAttempt, this.MAX_BACKOFF_MS)
			const jitter = Math.random() * 2000
			waitMs = exponentialWait + jitter
			Logger.warn(`[QUOTA:BACKOFF] Applied ${Math.round(waitMs)}ms (Tier: ${tierId ?? "unknown"}, Status: ${status})`)
		}

		this.resetUntil = Date.now() + waitMs

		// Wire up high-fidelity telemetry
		telemetryService.capture({
			event: "task.provider_api_error",
			properties: {
				provider: "google-personal",
				status_code: status,
				tier_id: tierId,
				backoff_attempt: this.backoffAttempt,
				consecutive_errors: this.consecutiveErrors,
				circuit_tripped: this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS,
				wait_ms: waitMs,
			},
		})

		return waitMs
	}

	resetBackoff(): void {
		this.backoffAttempt = 0
		this.consecutiveErrors = 0
		this.circuitBreakerTrippedUntil = 0
	}

	private checkAborted(signal: AbortSignal): void {
		if (signal.aborted) throw new Error("Aborted.")
	}
}

const orchestrator = new QuotaOrchestrator()

export interface GooglePersonalHandlerOptions extends CommonApiHandlerOptions {
	apiModelId?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
	onStatus?: (status: string) => void
}

export class GooglePersonalHandler implements ApiHandler {
	private options: GooglePersonalHandlerOptions
	private abortController?: AbortController
	private sessionId: string

	constructor(options: GooglePersonalHandlerOptions) {
		this.options = options
		this.sessionId = uuidv4()
	}

	private buildHeaders(token: string): Record<string, string> {
		return {
			...buildExternalBasicHeaders(),
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		}
	}

	private getBaseUrl(): string {
		return `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}`
	}

	private async ensureOnboarded(token: string): Promise<OnboardingData> {
		if (cachedOnboardingData && Date.now() - cachedOnboardingData.cachedAt < ONBOARDING_CACHE_TTL_MS) {
			return cachedOnboardingData
		}

		const baseUrl = this.getBaseUrl()
		const headers = this.buildHeaders(token)

		Logger.info("[IDENTITY] Syncing Cloud Code authority substrate...")
		const loadResponse = await fetch(`${baseUrl}:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				metadata: { ideType: "VSCODE", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
				mode: "HEALTH_CHECK",
			}),
		})

		if (!loadResponse.ok) {
			const errorText = await loadResponse.text()
			if (loadResponse.status === 401 || loadResponse.status === 403) {
				throw new Error("Authentication stale. Please sign out and sign in again with Google.")
			}
			throw new Error(`Onboarding check failed (${loadResponse.status}): ${errorText}`)
		}

		const loadData = await loadResponse.json()
		if (loadData.cloudaicompanionProject) {
			cachedOnboardingData = {
				projectId: loadData.cloudaicompanionProject,
				tierId: loadData.paidTier?.id ?? loadData.currentTier?.id,
				tierName: loadData.paidTier?.name ?? loadData.currentTier?.name,
				cachedAt: Date.now(),
			}
			return cachedOnboardingData
		}

		const onboardTier = loadData.allowedTiers?.find((t: any) => t.isDefault) || { id: "free-tier" }
		const onboardResponse = await fetch(`${baseUrl}:onboardUser`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				tierId: onboardTier.id,
				metadata: { ideType: "VSCODE", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
			}),
		})

		if (!onboardResponse.ok) throw new Error(`Onboarding failed: ${await onboardResponse.text()}`)

		let onboardData = await onboardResponse.json()
		if (!onboardData.done && onboardData.name) {
			const startTime = Date.now()
			while (!onboardData.done) {
				if (Date.now() - startTime > MAX_ONBOARDING_POLL_MS) throw new Error("Onboarding timed out.")
				await new Promise((resolve) => setTimeout(resolve, ONBOARDING_POLL_INTERVAL_MS))
				const pollRes = await fetch(`${baseUrl}/${onboardData.name}`, { method: "GET", headers })
				onboardData = await pollRes.json()
			}
		}

		const projectId = onboardData.response?.cloudaicompanionProject?.id
		if (!projectId) throw new Error("No project assigned after onboarding.")

		cachedOnboardingData = {
			projectId,
			tierId: onboardTier.id,
			tierName: onboardTier.name,
			cachedAt: Date.now(),
		}
		return cachedOnboardingData
	}

	async *createMessage(
		systemPrompt: string,
		messages: DietCodeStorageMessage[],
		_tools?: DietCodeTool[],
		_useResponseApi?: boolean,
	): ApiStream {
		this.abortController = new AbortController()
		const signal = this.abortController.signal

		await orchestrator.waitForClearance(signal, this.options.onStatus)

		try {
			const token = await AuthService.getInstance().getAuthToken("google")
			if (!token) throw new Error("Google account not linked.")

			const onboardingData = await this.ensureOnboarded(token)
			const { id: modelId, info } = this.getModel()
			const contents = messages.map((msg) => convertAnthropicMessageToGemini(msg, modelId))

			const _thinkingBudget = this.options.thinkingBudgetTokens ?? 0
			const thinkingBudget = Math.min(_thinkingBudget, info.thinkingConfig?.maxBudget ?? 65536)
			let thinkingConfig: any

			if (info.thinkingConfig) {
				const effort = (this.options.reasoningEffort || "").toLowerCase()
				if ((effort !== "none" && effort !== "off") || thinkingBudget > 0) {
					thinkingConfig = { includeThoughts: true, thinkingBudget: thinkingBudget > 0 ? thinkingBudget : 1024 }
				}
			}

			const generationConfig: any = { temperature: thinkingConfig ? 1 : (info.temperature ?? 1), topP: 0.95, topK: 64 }
			if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig

			const request = {
				model: modelId,
				project: onboardingData.projectId,
				user_prompt_id: uuidv4(),
				request: {
					contents,
					systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
					generationConfig,
					session_id: this.sessionId,
				},
			}

			const url = `${this.getBaseUrl()}:streamGenerateContent?alt=sse`
			const headers = this.buildHeaders(token)
			let lastError: Error | null = null

			for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
				if (signal.aborted) throw new Error("Aborted.")
				if (attempt > 0) await new Promise((res) => setTimeout(res, STREAM_RETRY_DELAY_MS * attempt))

				try {
					const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request), signal })

					if (!response.ok) {
						const rawError = await response.text()
						const errorJson = JSON.parse(rawError).error || {}
						const errorDetail = errorJson.message || rawError

						// V19 Hardening: Record with tier-awareness
						const waitMs = orchestrator.recordQuotaEvent(errorDetail, response.status, onboardingData.tierId)

						if ((response.status === 429 || response.status >= 500) && attempt < MAX_STREAM_RETRIES) {
							if (response.status === 429) {
								this.options.onStatus?.(`Rate limited. Resetting in ${Math.ceil(waitMs / 1000)}s...`)
							}
							if (response.status >= 500) cachedOnboardingData = null
							lastError = new Error(`API error (${response.status}): ${errorDetail}`)
							continue
						}
						throw new Error(`API Error (${response.status}): ${errorDetail}`)
					}

					orchestrator.resetBackoff()
					if (!response.body) throw new Error("Empty body.")

					const reader = response.body.getReader()
					const decoder = new TextDecoder()
					let buffer = ""
					let bufferedDataLines: string[] = []

					try {
						while (true) {
							const { done, value } = await reader.read()
							if (done) {
								if (bufferedDataLines.length > 0) yield* this.parseSSEChunk(bufferedDataLines.join("\n"))
								break
							}

							buffer += decoder.decode(value, { stream: true })
							let newlineIndex: number
							while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
								const line = buffer.slice(0, newlineIndex).trim()
								buffer = buffer.slice(newlineIndex + 1)

								if (line.startsWith("data: ")) {
									bufferedDataLines.push(line.slice(6).trim())
								} else if (line === "" && bufferedDataLines.length > 0) {
									const chunk = bufferedDataLines.join("\n")
									bufferedDataLines = []
									if (chunk && chunk !== "[DONE]") yield* this.parseSSEChunk(chunk)
								}
							}
							if (signal.aborted) {
								await reader.cancel()
								break
							}
						}
						return
					} finally {
						reader.releaseLock()
					}
				} catch (e) {
					if ((e as Error).name === "AbortError") throw e
					if (attempt === MAX_STREAM_RETRIES) throw e
					lastError = e as Error
				}
			}
			throw lastError || new Error("Failed after retries.")
		} finally {
			orchestrator.release()
		}
	}

	private *parseSSEChunk(chunk: string): Generator<any> {
		try {
			// V19 Hardening: Handle resonance where multiple JSON objects arrive in one chunk
			const segments = chunk.split(/\n(?={)/)
			for (const segment of segments) {
				const json = JSON.parse(segment)
				const vertexResponse = json.response || json
				if (vertexResponse?.candidates) {
					const parts = vertexResponse.candidates[0]?.content?.parts || []
					for (const part of parts) {
						if (part.thought && part.text) {
							yield { type: "reasoning", reasoning: part.text, id: json.traceId, signature: part.thoughtSignature }
						} else if (part.text) {
							yield { type: "text", text: part.text, id: json.traceId, signature: part.thoughtSignature }
						}
					}
					if (vertexResponse.usageMetadata) {
						const usage = vertexResponse.usageMetadata
						yield {
							type: "usage",
							inputTokens: usage.promptTokenCount ?? 0,
							outputTokens: usage.candidatesTokenCount ?? 0,
							totalCost: 0,
						}
					}
				}
			}
		} catch (e) {
			Logger.error("[SSE:PARSE_FAIL]", { chunk: chunk.slice(0, 100) })
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		const info = (geminiModels as any)[modelId || geminiDefaultModelId]
		return { id: modelId || geminiDefaultModelId, info }
	}

	abort() {
		this.abortController?.abort()
	}
}

export function clearGooglePersonalOnboardingCache() {
	cachedOnboardingData = null
}
