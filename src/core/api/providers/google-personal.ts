import { geminiDefaultModelId, geminiModels, ModelInfo } from "@shared/api"
import { v4 as uuidv4 } from "uuid"
import { AuthService } from "@/services/auth/AuthService"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
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
const MAX_STREAM_RETRIES = 2
const STREAM_RETRY_DELAY_MS = 1_000

/**
 * Cached onboarding data from the Cloud Code API.
 * The loadCodeAssist call provisions the user and returns a project ID
 * which is required for all subsequent streamGenerateContent calls.
 *
 * Architecture note: Gemini CLI caches this per-AuthClient via a WeakMap with 30s TTL.
 * We use a simpler module-level cache since DietCode has a single Google session per extension lifetime.
 * The cache is cleared on: sign-out, 500 errors, and explicit cache invalidation.
 */
interface OnboardingData {
	projectId: string
	tierId?: string
	tierName?: string
	cachedAt: number
}

/**
 * TTL for the onboarding cache. After this period, we re-validate the user tier.
 * Gemini CLI uses 30 seconds; we use 5 minutes since the VS Code extension lifecycle is longer.
 */
const ONBOARDING_CACHE_TTL_MS = 5 * 60 * 1000

// Module-level cache so we only onboard once per session
let cachedOnboardingData: OnboardingData | null = null

export interface GooglePersonalHandlerOptions extends CommonApiHandlerOptions {
	apiModelId?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
}

export class GooglePersonalHandler implements ApiHandler {
	private options: GooglePersonalHandlerOptions
	private abortController?: AbortController
	private sessionId: string

	constructor(options: GooglePersonalHandlerOptions) {
		this.options = options
		this.sessionId = uuidv4()
	}

	/**
	 * Builds the standard headers required for all Cloud Code API calls.
	 * Mirrors the header construction in Gemini CLI's server.ts.
	 */
	private buildHeaders(token: string): Record<string, string> {
		return {
			...buildExternalBasicHeaders(),
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		}
	}

	/**
	 * Returns the base URL for the Cloud Code API.
	 * Mirrors Gemini CLI's getBaseUrl() method.
	 */
	private getBaseUrl(): string {
		return `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}`
	}

	/**
	 * Performs the user onboarding flow required by the Cloud Code API.
	 * This mirrors Gemini CLI's setup.ts: loadCodeAssist → onboardUser flow.
	 *
	 * Flow:
	 * 1. loadCodeAssist — checks if user is already provisioned, returns tier + project
	 * 2. If no project: onboardUser — provisions the user for the default tier (usually FREE)
	 * 3. If onboarding is async: polls the LRO until done
	 *
	 * The returned projectId is required for all streamGenerateContent calls.
	 * Without it, the Cloud Code API returns 500: "Internal error encountered."
	 */
	private async ensureOnboarded(token: string): Promise<OnboardingData> {
		// Check cache validity - both existence and TTL
		if (cachedOnboardingData && Date.now() - cachedOnboardingData.cachedAt < ONBOARDING_CACHE_TTL_MS) {
			return cachedOnboardingData
		}

		const baseUrl = this.getBaseUrl()
		const headers = this.buildHeaders(token)

		// ─────────────────────────────────────────────────────
		// Step 1: loadCodeAssist — check if user is already provisioned
		// Mirrors: setup.ts → _doSetupUser → caServer.loadCodeAssist()
		// ─────────────────────────────────────────────────────
		Logger.info("Google Personal: Starting user onboarding check...")
		const loadRequest = {
			metadata: {
				ideType: "VSCODE" as const,
				platform: "PLATFORM_UNSPECIFIED" as const,
				pluginType: "GEMINI" as const,
			},
			mode: "HEALTH_CHECK",
		}

		const loadResponse = await fetch(`${baseUrl}:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify(loadRequest),
		})

		if (!loadResponse.ok) {
			const errorText = await loadResponse.text()
			Logger.error("Google Personal: loadCodeAssist failed", {
				status: loadResponse.status,
				error: errorText,
			})

			// Parse structured error for actionable messages
			let parsedMessage = errorText
			try {
				const errorJson = JSON.parse(errorText)
				parsedMessage = errorJson.error?.message || errorJson.message || errorText
			} catch {
				// Raw text fallback
			}

			if (loadResponse.status === 401 || loadResponse.status === 403) {
				throw new Error(
					`Google authentication failed (${loadResponse.status}): ${parsedMessage}. ` +
						"Please sign out and sign in again with Google.",
				)
			}

			throw new Error(
				`Google Personal onboarding failed (${loadResponse.status}): ${parsedMessage}. ` +
					"Please try again or check your network connection.",
			)
		}

		const loadData = await loadResponse.json()
		Logger.info("Google Personal: loadCodeAssist response received", {
			hasCurrentTier: !!loadData.currentTier,
			currentTierId: loadData.currentTier?.id,
			currentTierName: loadData.currentTier?.name,
			hasProject: !!loadData.cloudaicompanionProject,
			hasPaidTier: !!loadData.paidTier,
			allowedTierCount: loadData.allowedTiers?.length || 0,
			ineligibleTierCount: loadData.ineligibleTiers?.length || 0,
		})

		// ─────────────────────────────────────────────────────
		// Handle ineligible tiers (mirrors setup.ts → validateLoadCodeAssistResponse)
		// ─────────────────────────────────────────────────────
		if (!loadData.currentTier && loadData.ineligibleTiers?.length > 0) {
			const reasons = loadData.ineligibleTiers.map((t: any) => t.reasonMessage || t.reasonCode || "Unknown").join("; ")
			Logger.error("Google Personal: User is ineligible", { reasons })
			throw new Error(`Your Google account is not eligible for Gemini: ${reasons}`)
		}

		// ─────────────────────────────────────────────────────
		// If user is already provisioned with a project, use it
		// Mirrors: setup.ts → return { projectId: loadRes.cloudaicompanionProject, ... }
		// ─────────────────────────────────────────────────────
		if (loadData.cloudaicompanionProject) {
			cachedOnboardingData = {
				projectId: loadData.cloudaicompanionProject,
				tierId: loadData.paidTier?.id ?? loadData.currentTier?.id,
				tierName: loadData.paidTier?.name ?? loadData.currentTier?.name,
				cachedAt: Date.now(),
			}
			Logger.info("Google Personal: User already onboarded", {
				projectId: cachedOnboardingData.projectId,
				tier: cachedOnboardingData.tierName,
			})
			return cachedOnboardingData
		}

		// ─────────────────────────────────────────────────────
		// If currentTier exists but no project, check for env-var override
		// Mirrors: setup.ts → if (projectId) { return { projectId, ... } }
		// ─────────────────────────────────────────────────────
		if (loadData.currentTier) {
			const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID
			if (envProjectId) {
				cachedOnboardingData = {
					projectId: envProjectId,
					tierId: loadData.paidTier?.id ?? loadData.currentTier.id,
					tierName: loadData.paidTier?.name ?? loadData.currentTier.name,
					cachedAt: Date.now(),
				}
				Logger.info("Google Personal: Using project from environment variable", cachedOnboardingData)
				return cachedOnboardingData
			}

			// If user has currentTier but no project and no env var, need to check for ineligibility
			if (!loadData.allowedTiers || loadData.allowedTiers.length === 0) {
				if (loadData.ineligibleTiers?.length > 0) {
					const reasons = loadData.ineligibleTiers
						.map((t: any) => t.reasonMessage || t.reasonCode || "Unknown")
						.join("; ")
					throw new Error(`Your Google account requires additional setup: ${reasons}`)
				}
				throw new Error(
					"No Gemini tier is available for your account. " +
						"Set the GOOGLE_CLOUD_PROJECT environment variable or contact your administrator.",
				)
			}
		}

		// ─────────────────────────────────────────────────────
		// Step 2: onboardUser — provision the user for the default tier
		// Mirrors: setup.ts → getOnboardTier() → caServer.onboardUser()
		// ─────────────────────────────────────────────────────
		Logger.info("Google Personal: User not provisioned, starting onboarding...")

		// Find the default tier from allowedTiers (exactly like Gemini CLI's getOnboardTier)
		let onboardTier: any = null
		if (loadData.allowedTiers) {
			onboardTier = loadData.allowedTiers.find((t: any) => t.isDefault) || null
		}
		if (!onboardTier) {
			// Fallback to legacy tier (matches Gemini CLI's fallback)
			onboardTier = { id: "legacy-tier", name: "", description: "" }
		}

		const onboardTierId = onboardTier.id
		const isFreeOrLegacy = onboardTierId === "free-tier" || onboardTierId === "legacy-tier"
		const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID

		// Match Gemini CLI's OnboardUserRequest format exactly
		// For free tier: don't set project (causes "Precondition Failed" per Gemini CLI comments)
		const onboardRequest: any = {
			tierId: onboardTierId,
			metadata: {
				ideType: "VSCODE" as const,
				platform: "PLATFORM_UNSPECIFIED" as const,
				pluginType: "GEMINI" as const,
			},
		}

		// Only set project for non-free tiers (mirrors Gemini CLI's conditional logic)
		if (!isFreeOrLegacy && envProjectId) {
			onboardRequest.cloudaicompanionProject = envProjectId
			onboardRequest.metadata.duetProject = envProjectId
		}

		const onboardResponse = await fetch(`${baseUrl}:onboardUser`, {
			method: "POST",
			headers,
			body: JSON.stringify(onboardRequest),
		})

		if (!onboardResponse.ok) {
			const errorText = await onboardResponse.text()
			Logger.error("Google Personal: onboardUser failed", {
				status: onboardResponse.status,
				error: errorText,
				tierId: onboardTierId,
			})

			let parsedMessage = errorText
			try {
				const errorJson = JSON.parse(errorText)
				parsedMessage = errorJson.error?.message || errorJson.message || errorText
			} catch {
				// Raw text fallback
			}

			throw new Error(
				`Google Personal onboarding failed (${onboardResponse.status}): ${parsedMessage}. ` +
					"Your Google account may not be eligible for the Gemini free tier.",
			)
		}

		let onboardData = await onboardResponse.json()

		// ─────────────────────────────────────────────────────
		// Handle Long-Running Operation (LRO)
		// Mirrors: setup.ts → while (!lroRes.done) { await getOperation }
		// ─────────────────────────────────────────────────────
		if (!onboardData.done && onboardData.name) {
			Logger.info("Google Personal: Onboarding in progress, polling LRO...", { name: onboardData.name })
			const operationName = onboardData.name
			const startTime = Date.now()

			while (!onboardData.done) {
				if (Date.now() - startTime > MAX_ONBOARDING_POLL_MS) {
					throw new Error(
						"Google Personal onboarding timed out after 2 minutes. " + "Please try again later or contact support.",
					)
				}

				await new Promise((resolve) => setTimeout(resolve, ONBOARDING_POLL_INTERVAL_MS))

				const pollResponse = await fetch(`${baseUrl}/${operationName}`, {
					method: "GET",
					headers,
				})
				if (!pollResponse.ok) {
					const pollError = await pollResponse.text()
					Logger.error("Google Personal: LRO poll failed", {
						status: pollResponse.status,
						error: pollError,
					})
					throw new Error(`Google Personal onboarding poll failed (${pollResponse.status}): ${pollError}`)
				}
				onboardData = await pollResponse.json()
			}
		}

		// ─────────────────────────────────────────────────────
		// Extract project ID from onboarding response
		// Mirrors: setup.ts → lroRes.response.cloudaicompanionProject.id
		// ─────────────────────────────────────────────────────
		const projectId = onboardData.response?.cloudaicompanionProject?.id
		if (!projectId) {
			// Try env var as fallback (matches Gemini CLI's fallback path)
			if (envProjectId) {
				cachedOnboardingData = {
					projectId: envProjectId,
					tierId: onboardTierId,
					tierName: onboardTier.name,
					cachedAt: Date.now(),
				}
				Logger.info("Google Personal: Using env project after onboarding", cachedOnboardingData)
				return cachedOnboardingData
			}

			Logger.error("Google Personal: Onboarding completed but no project ID returned", onboardData)
			throw new Error(
				"Google Personal onboarding completed but no project was assigned. " +
					"Set the GOOGLE_CLOUD_PROJECT environment variable, or try signing out and in again.",
			)
		}

		cachedOnboardingData = {
			projectId,
			tierId: onboardTierId,
			tierName: onboardTier.name,
			cachedAt: Date.now(),
		}
		Logger.info("Google Personal: Onboarding successful", {
			projectId: cachedOnboardingData.projectId,
			tier: cachedOnboardingData.tierName,
		})
		return cachedOnboardingData
	}

	async *createMessage(systemPrompt: string, messages: DietCodeStorageMessage[]): ApiStream {
		this.abortController = new AbortController()
		const token = await AuthService.getInstance().getAuthToken("google")
		if (!token) {
			throw new Error("Google Personal provider requires you to be signed in with Google.")
		}

		// Ensure user is onboarded and get project ID
		const onboardingData = await this.ensureOnboarded(token)

		const { id: modelId, info } = this.getModel()
		const contents = messages.map((msg) => convertAnthropicMessageToGemini(msg, modelId))

		// ─────────────────────────────────────────────────────
		// Configure thinking — match Gemini CLI's thinkingConfig schema
		// Gemini CLI places thinkingConfig INSIDE generationConfig (see converter.ts line 74, 311)
		// ─────────────────────────────────────────────────────
		const _thinkingBudget = this.options.thinkingBudgetTokens ?? 0
		const maxBudget = info.thinkingConfig?.maxBudget ?? 65536
		const thinkingBudget = Math.min(_thinkingBudget, maxBudget)

		let thinkingConfig: any

		if (info.thinkingConfig) {
			const rawReasoningEffort = (this.options.reasoningEffort || "").toLowerCase()
			const normalizedReasoningEffort =
				!rawReasoningEffort || rawReasoningEffort === "none" || rawReasoningEffort === "off" ? "none" : rawReasoningEffort

			if (normalizedReasoningEffort !== "none" || thinkingBudget > 0) {
				thinkingConfig = {
					includeThoughts: true,
					thinkingBudget: thinkingBudget > 0 ? thinkingBudget : 1024,
				}
			}
		}

		// ─────────────────────────────────────────────────────
		// Build request matching Gemini CLI's CAGenerateContentRequest format EXACTLY
		// See converter.ts: { model, project, user_prompt_id, request: { contents, systemInstruction, generationConfig } }
		// ─────────────────────────────────────────────────────
		const generationConfig: any = {
			// Gemini CLI sets temperature: 1, topP: 0.95, topK: 64 for chat-base config
			temperature: thinkingConfig ? 1 : (info.temperature ?? 1),
			topP: 0.95,
			topK: 64,
		}

		// CRITICAL: thinkingConfig goes INSIDE generationConfig (not at request level)
		// This matches Gemini CLI's VertexGenerationConfig interface (converter.ts line 74)
		if (thinkingConfig) {
			generationConfig.thinkingConfig = thinkingConfig
		}

		const request: any = {
			model: modelId,
			project: onboardingData.projectId,
			user_prompt_id: uuidv4(),
			request: {
				contents,
				systemInstruction: {
					role: "user",
					parts: [{ text: systemPrompt }],
				},
				generationConfig,
				session_id: this.sessionId,
			},
		}

		Logger.debug(
			`Google Personal Request: ${JSON.stringify({ model: request.model, project: request.project, hasThinking: !!thinkingConfig })}`,
		)

		// ─────────────────────────────────────────────────────
		// Send request with retry logic for transient errors
		// Gemini CLI uses gaxios retry: { retry: 3, statusCodesToRetry: [[429,429],[499,499],[500,599]] }
		// ─────────────────────────────────────────────────────
		const url = `${this.getBaseUrl()}:streamGenerateContent?alt=sse`
		const headers = this.buildHeaders(token)

		let lastError: Error | null = null

		for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
			if (attempt > 0) {
				Logger.warn(`Google Personal: Retrying streamGenerateContent (attempt ${attempt + 1}/${MAX_STREAM_RETRIES + 1})`)
				await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_DELAY_MS * attempt))
			}

			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(request),
				signal: this.abortController.signal,
			})

			if (!response.ok) {
				const rawError = await response.text()
				let errorDetail = rawError
				try {
					const errorJson = JSON.parse(rawError)
					errorDetail = errorJson.error?.message || errorJson.message || rawError
				} catch {
					// Fallback to raw text
				}

				Logger.error(`Google Personal API error (${response.status})`, {
					status: response.status,
					detail: errorDetail,
					url,
					attempt,
				})

				// Retry on transient server errors (500-599, 429)
				if ((response.status >= 500 || response.status === 429) && attempt < MAX_STREAM_RETRIES) {
					// Clear onboarding cache on 500 — might be a stale project
					if (response.status === 500) {
						cachedOnboardingData = null
						Logger.warn("Google Personal: Cleared onboarding cache due to 500 error")
					}
					lastError = new Error(`Google Personal API error (${response.status}): ${errorDetail}`)
					continue
				}

				// Non-retryable errors — provide actionable messages
				if (response.status === 401 || response.status === 403) {
					cachedOnboardingData = null
					throw new Error(
						`Google Personal authentication error (${response.status}): ${errorDetail}. ` +
							"Please sign out and sign in again with Google.",
					)
				}
				if (response.status === 404) {
					throw new Error(
						`Model '${modelId}' not found on Google Personal API. ` +
							"This model may not be available for your account tier.",
					)
				}

				throw new Error(`Google Personal API error (${response.status}): ${errorDetail}`)
			}

			if (!response.body) {
				throw new Error("No response body received from Google Personal API")
			}

			// ─────────────────────────────────────────────────────
			// SSE Stream Parser
			// Gemini CLI uses readline.createInterface with bufferedLines.
			// We use a manual parser that handles multi-line SSE data correctly.
			// Key difference from old code: we now buffer multi-line SSE data
			// and only parse on empty line boundary (matching SSE spec + Gemini CLI).
			// ─────────────────────────────────────────────────────
			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ""
			let bufferedDataLines: string[] = []

			try {
				while (true) {
					if (this.abortController.signal.aborted) {
						await reader.cancel()
						break
					}

					const { done, value } = await reader.read()
					if (done) {
						// Process any remaining buffered data
						if (bufferedDataLines.length > 0) {
							yield* this.parseSSEChunk(bufferedDataLines.join("\n"))
						}
						break
					}

					buffer += decoder.decode(value, { stream: true })

					// Process complete lines from the buffer
					let newlineIndex: number
					while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
						const line = buffer.slice(0, newlineIndex).trim()
						buffer = buffer.slice(newlineIndex + 1)

						if (line.startsWith("data: ")) {
							bufferedDataLines.push(line.slice(6).trim())
						} else if (line === "" && bufferedDataLines.length > 0) {
							// Empty line = end of SSE event, yield the accumulated data
							// This matches Gemini CLI's readline-based approach
							const chunk = bufferedDataLines.join("\n")
							bufferedDataLines = []

							if (chunk && chunk !== "[DONE]") {
								yield* this.parseSSEChunk(chunk)
							}
						}
						// Ignore comment lines (starting with :) and other non-data lines
					}
				}
			} finally {
				reader.releaseLock()
			}

			// If we got here, the stream completed successfully
			return
		}

		// All retries exhausted
		throw lastError || new Error("Google Personal API request failed after all retries")
	}

	/**
	 * Parses a single SSE chunk and yields the appropriate stream events.
	 * Extracted to enable the retry loop to share parsing logic.
	 */
	private *parseSSEChunk(chunk: string): Generator<any> {
		try {
			const json = JSON.parse(chunk)
			// The Cloud Code API wraps the Vertex response in a .response field
			// (see converter.ts: CaGenerateContentResponse { response?: VertexGenerateContentResponse })
			const vertexResponse = json.response || json

			if (vertexResponse && vertexResponse.candidates) {
				const parts = vertexResponse.candidates[0]?.content?.parts || []
				for (const part of parts) {
					if (part.thought && part.text) {
						yield {
							type: "reasoning" as const,
							reasoning: part.text,
							id: json.traceId,
							signature: part.thoughtSignature,
						}
					} else if (part.text) {
						yield {
							type: "text" as const,
							text: part.text,
							id: json.traceId,
							signature: part.thoughtSignature,
						}
					}
				}

				if (vertexResponse.usageMetadata) {
					const usage = vertexResponse.usageMetadata
					yield {
						type: "usage" as const,
						inputTokens: usage.promptTokenCount ?? 0,
						outputTokens: usage.candidatesTokenCount ?? 0,
						totalCost: 0, // Free tier — no cost
					}
				}
			}
		} catch (e) {
			Logger.error("Failed to parse Google Personal API response chunk", { error: e, chunkLength: chunk.length })
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

/**
 * Clear the onboarding cache. Called when the user signs out from Google
 * to force re-onboarding on next sign-in.
 */
export function clearGooglePersonalOnboardingCache() {
	cachedOnboardingData = null
}
