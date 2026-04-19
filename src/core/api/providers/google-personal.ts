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
 */
const CODE_ASSIST_ENDPOINT = process.env.CODE_ASSIST_ENDPOINT || "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = process.env.CODE_ASSIST_API_VERSION || "v1internal"

const MAX_ONBOARDING_POLL_MS = 120_000
const ONBOARDING_POLL_INTERVAL_MS = 5_000
const MAX_STREAM_RETRIES = 3
const STREAM_RETRY_DELAY_MS = 2_000
const ONBOARDING_CACHE_TTL_MS = 5 * 60 * 1000

interface OnboardingData {
	projectId: string
	tierId?: string
	tierName?: string
	cachedAt: number
}

let cachedOnboardingData: OnboardingData | null = null

enum CircuitState {
	CLOSED = "CLOSED",
	DEGRADED = "DEGRADED",
	OPEN = "OPEN",
	HALF_OPEN = "HALF_OPEN",
}

/**
 * Sovereign Quota Orchestrator (V20 Balanced)
 * Evolved state machine for graduated resilience and proactive self-healing.
 */
class QuotaOrchestrator {
	private state = CircuitState.CLOSED
	private resetUntil = 0
	private activeCount = 0
	private backoffAttempt = 0
	private consecutiveErrors = 0
	private circuitOpenUntil = 0
	private lastLockoutDuration = 2 * 60 * 1000 // Initial 2m lockout

	private readonly maxConcurrent = 1
	private readonly DEGRADED_THRESHOLD = 2
	private readonly OPEN_THRESHOLD = 5
	private readonly MAX_LOCKOUT_MS = 15 * 60 * 1000
	private readonly MAX_BACKOFF_MS = 60_000

	async waitForClearance(
		signal: AbortSignal,
		probeAction: () => Promise<void>,
		onStatus?: (status: string) => void,
	): Promise<void> {
		this.checkAborted(signal)

		// 1. State Transition Check
		if (this.state === CircuitState.OPEN && Date.now() >= this.circuitOpenUntil) {
			this.state = CircuitState.HALF_OPEN
			Logger.info("[QUOTA:STATE] Transitioning to HALF_OPEN. Ready for probe.")
		}

		// 2. Circuit Breaker Barrier
		if (this.state === CircuitState.OPEN) {
			const waitMs = this.circuitOpenUntil - Date.now()
			const waitSec = Math.ceil(waitMs / 1000)
			throw new Error(`Google Personal API is currently locked. Recovery probe available in ${waitSec}s.`)
		}

		// 3. Quota Recovery Barrier
		while (Date.now() < this.resetUntil) {
			const waitMs = this.resetUntil - Date.now()
			if (waitMs > 0) {
				const waitSec = Math.ceil(waitMs / 1000)
				onStatus?.(`Quota cooldown active (${waitSec}s)...`)
				const sleepChunk = Math.min(waitMs, 500)
				await new Promise((resolve) => setTimeout(resolve, sleepChunk))
				this.checkAborted(signal)
			}
		}

		// 4. Concurrency Limit
		while (this.activeCount >= this.maxConcurrent) {
			await new Promise((resolve) => setTimeout(resolve, 200))
			this.checkAborted(signal)
		}

		// 5. Proactive Health Probe
		if (this.state === CircuitState.HALF_OPEN) {
			onStatus?.("Performing recovery health probe...")
			Logger.info("[QUOTA:PROBE] Initiating recovery health check...")
			try {
				await probeAction()
				this.recordProbeSuccess()
			} catch (e) {
				this.recordProbeFailure()
				throw new Error(`Recovery probe failed: ${(e as Error).message}`)
			}
		}

		this.activeCount++
	}

	release(): void {
		this.activeCount = Math.max(0, this.activeCount - 1)
	}

	recordQuotaEvent(errorDetail: string, status: number, tierId?: string): number {
		this.consecutiveErrors++

		// Evolution: Graduated State Transitions
		if (this.state === CircuitState.CLOSED && this.consecutiveErrors >= this.DEGRADED_THRESHOLD) {
			this.state = CircuitState.DEGRADED
			Logger.warn(`[QUOTA:STATE] System is DEGRADED (${this.consecutiveErrors} errors). Intensity increasing.`)
		}

		if (this.consecutiveErrors >= this.OPEN_THRESHOLD) {
			this.state = CircuitState.OPEN
			this.circuitOpenUntil = Date.now() + this.lastLockoutDuration
			Logger.error(`[QUOTA:STATE] System is OPEN. Lockout active for ${this.lastLockoutDuration / 1000}s.`)
			// Graduate lockout for repeated failures
			this.lastLockoutDuration = Math.min(this.lastLockoutDuration * 2, this.MAX_LOCKOUT_MS)
		}

		const secondsMatch = errorDetail.match(/reset after (\d+)s/i)
		let waitMs: number

		if (secondsMatch) {
			waitMs = (Number.parseInt(secondsMatch[1], 10) + 1) * 1000
			this.backoffAttempt = 0
		} else {
			this.backoffAttempt++
			// Degraded multiplier: increase pressure resistance
			const multiplier = (this.state === CircuitState.DEGRADED ? 3.0 : 2.0) * (tierId === "free-tier" ? 1.5 : 1.0)
			const baseWait = status === 429 ? 5000 : 2000
			waitMs = Math.min(baseWait * multiplier ** this.backoffAttempt, this.MAX_BACKOFF_MS) + Math.random() * 2000
		}

		this.resetUntil = Date.now() + waitMs

		telemetryService.capture({
			event: "task.provider_api_error",
			properties: {
				provider: "google-personal",
				status_code: status,
				tier_id: tierId,
				backoff_attempt: this.backoffAttempt,
				consecutive_errors: this.consecutiveErrors,
				state: this.state,
				wait_ms: waitMs,
			},
		})

		return waitMs
	}

	recordSuccess(): void {
		// Self-healing Success Windows: gradually decrement errors in degraded mode
		if (this.state === CircuitState.DEGRADED) {
			this.consecutiveErrors--
			if (this.consecutiveErrors <= 0) {
				this.state = CircuitState.CLOSED
				Logger.info("[QUOTA:STATE] System fully healed. State: CLOSED.")
			}
		} else if (this.state === CircuitState.HALF_OPEN) {
			this.state = CircuitState.CLOSED
			this.consecutiveErrors = 0
			this.lastLockoutDuration = 2 * 60 * 1000 // Reset cooldown on full success
		}
		this.backoffAttempt = 0
	}

	private recordProbeSuccess(): void {
		Logger.info("[QUOTA:PROBE] Probe succeeded. System entering stabilization period.")
		this.state = CircuitState.DEGRADED // Start in degraded to prove stability
		this.consecutiveErrors = this.DEGRADED_THRESHOLD
	}

	private recordProbeFailure(): void {
		this.state = CircuitState.OPEN
		this.circuitOpenUntil = Date.now() + this.lastLockoutDuration
		Logger.error(`[QUOTA:PROBE] Probe failed. Extending lockout to ${this.lastLockoutDuration / 1000}s.`)
		this.lastLockoutDuration = Math.min(this.lastLockoutDuration * 2, this.MAX_LOCKOUT_MS)
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

		Logger.info("[IDENTITY] Syncing Google Personal authority...")
		const loadResponse = await fetch(`${baseUrl}:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				metadata: { ideType: "VSCODE", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
				mode: "HEALTH_CHECK",
			}),
		})

		if (!loadResponse.ok) {
			if (loadResponse.status === 401 || loadResponse.status === 403) {
				throw new Error("Authentication stale. Please re-link Google account.")
			}
			throw new Error(`Project sync failed (${loadResponse.status})`)
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

		// Onboarding flow (simplified)
		const onboardResponse = await fetch(`${baseUrl}:onboardUser`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				tierId: loadData.allowedTiers?.[0]?.id || "free-tier",
				metadata: { ideType: "VSCODE", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
			}),
		})

		if (!onboardResponse.ok) throw new Error("Onboarding provision failed.")
		let onboardData = await onboardResponse.json()
		if (!onboardData.done && onboardData.name) {
			const startTime = Date.now()
			while (!onboardData.done) {
				if (Date.now() - startTime > MAX_ONBOARDING_POLL_MS) throw new Error("Timeout.")
				await new Promise((r) => setTimeout(r, ONBOARDING_POLL_INTERVAL_MS))
				onboardData = await (await fetch(`${baseUrl}/${onboardData.name}`, { method: "GET", headers })).json()
			}
		}

		const projectId = onboardData.response?.cloudaicompanionProject?.id
		if (!projectId) throw new Error("No project assigned.")

		cachedOnboardingData = { projectId, cachedAt: Date.now() }
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

		// V20: Balanced Clearance with Probe
		await orchestrator.waitForClearance(
			signal,
			async () => {
				const token = await AuthService.getInstance().getAuthToken("google")
				if (!token) throw new Error("No token.")
				await this.ensureOnboarded(token)
			},
			this.options.onStatus,
		)

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
						let errorDetail = rawError
						try {
							const errorJson = JSON.parse(rawError)
							errorDetail = errorJson.error?.message || errorJson.message || rawError
						} catch {
							/* parse error */
						}

						// V20 Classification
						if (response.status === 401 || response.status === 403) {
							throw new Error(`Authentication required (${response.status}). Please re-link Google.`)
						}

						const waitMs = orchestrator.recordQuotaEvent(errorDetail, response.status, onboardingData.tierId)

						if ((response.status === 429 || response.status >= 500) && attempt < MAX_STREAM_RETRIES) {
							if (response.status === 429) {
								this.options.onStatus?.(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`)
							}
							if (response.status >= 500) cachedOnboardingData = null
							lastError = new Error(`API error (${response.status}): ${errorDetail}`)
							continue
						}
						throw new Error(`API Error (${response.status}): ${errorDetail}`)
					}

					// V20 Healing Step
					orchestrator.recordSuccess()
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
					if ((e as Error).name === "AbortError" || (e as Error).message.includes("lockout")) throw e
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
