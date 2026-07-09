import { z } from "zod"
import { StateManager } from "@/core/storage/StateManager"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

export const XAI_OAUTH_CONFIG = {
	issuer: "https://auth.x.ai",
	discoveryEndpoint: "https://auth.x.ai/.well-known/openid-configuration",
	deviceCodeEndpoint: "https://auth.x.ai/oauth2/device/code",
	clientId: "b1a00492-073a-47ea-816f-4c329264a828",
	scopes: "openid profile email offline_access grok-cli:access api:access",
} as const

const XAI_OAUTH_CREDENTIALS_KEY = "xai-oauth-credentials"
const REFRESH_BUFFER_MS = 60 * 60 * 1000

const discoverySchema = z.object({
	token_endpoint: z.string().url(),
})

const deviceCodeSchema = z.object({
	device_code: z.string().min(1),
	user_code: z.string().min(1),
	verification_uri: z.string().url(),
	verification_uri_complete: z.string().url().optional(),
	expires_in: z.coerce.number().int().positive(),
	interval: z.coerce.number().int().positive(),
})

const tokenResponseSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	id_token: z.string().optional(),
	expires_in: z.coerce.number().positive(),
	token_type: z.string().optional(),
})

const xaiOAuthCredentialsSchema = z.object({
	type: z.literal("xai-oauth"),
	access_token: z.string().min(1),
	refresh_token: z.string().min(1),
	id_token: z.string().optional(),
	token_type: z.string().optional(),
	tokenEndpoint: z.string().url(),
	expires: z.number(),
})

export type XAIOAuthCredentials = z.infer<typeof xaiOAuthCredentialsSchema>

interface OAuthErrorBody {
	error?: string
	error_description?: string
}

function validateXAIEndpoint(endpoint: string): string {
	const url = new URL(endpoint)
	if (url.protocol !== "https:" || (url.hostname !== "x.ai" && !url.hostname.endsWith(".x.ai"))) {
		throw new Error(`Refusing untrusted xAI OAuth endpoint: ${endpoint}`)
	}
	return endpoint
}

async function responseError(response: Response): Promise<string> {
	const text = await response.text()
	try {
		const body = JSON.parse(text) as OAuthErrorBody
		return body.error_description || body.error || text
	} catch {
		return text
	}
}

async function discoverTokenEndpoint(): Promise<string> {
	const response = await fetch(XAI_OAUTH_CONFIG.discoveryEndpoint, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(20_000),
	})
	if (!response.ok) {
		throw new Error(`xAI OAuth discovery failed (HTTP ${response.status}): ${await responseError(response)}`)
	}
	const discovery = discoverySchema.parse(await response.json())
	return validateXAIEndpoint(discovery.token_endpoint)
}

async function requestDeviceCode(): Promise<z.infer<typeof deviceCodeSchema>> {
	const response = await fetch(XAI_OAUTH_CONFIG.deviceCodeEndpoint, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: XAI_OAUTH_CONFIG.clientId,
			scope: XAI_OAUTH_CONFIG.scopes,
		}).toString(),
		signal: AbortSignal.timeout(20_000),
	})
	if (!response.ok) {
		throw new Error(`xAI device authorization failed (HTTP ${response.status}): ${await responseError(response)}`)
	}
	return deviceCodeSchema.parse(await response.json())
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms)
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer)
				reject(new Error("xAI authorization was cancelled"))
			},
			{ once: true },
		)
	})
}

async function pollForTokens(
	deviceCode: string,
	tokenEndpoint: string,
	expiresIn: number,
	initialInterval: number,
	signal: AbortSignal,
): Promise<XAIOAuthCredentials> {
	const deadline = Date.now() + expiresIn * 1000
	let intervalSeconds = Math.max(1, initialInterval)

	while (Date.now() < deadline) {
		if (signal.aborted) throw new Error("xAI authorization was cancelled")

		const response = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: XAI_OAUTH_CONFIG.clientId,
				device_code: deviceCode,
			}).toString(),
			signal,
		})

		if (response.ok) {
			const tokens = tokenResponseSchema.parse(await response.json())
			if (!tokens.refresh_token) throw new Error("xAI OAuth did not return a refresh token")
			return {
				type: "xai-oauth",
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				id_token: tokens.id_token,
				token_type: tokens.token_type || "Bearer",
				tokenEndpoint,
				expires: Date.now() + tokens.expires_in * 1000,
			}
		}

		let error: OAuthErrorBody = {}
		try {
			error = (await response.json()) as OAuthErrorBody
		} catch {
			throw new Error(`xAI token polling failed (HTTP ${response.status})`)
		}
		if (error.error === "authorization_pending") {
			await wait(intervalSeconds * 1000, signal)
			continue
		}
		if (error.error === "slow_down") {
			intervalSeconds = Math.min(intervalSeconds + 1, 30)
			await wait(intervalSeconds * 1000, signal)
			continue
		}
		throw new Error(`xAI token polling failed: ${error.error_description || error.error || response.statusText}`)
	}

	throw new Error("xAI authorization timed out")
}

async function refreshCredentials(credentials: XAIOAuthCredentials): Promise<XAIOAuthCredentials> {
	const tokenEndpoint = validateXAIEndpoint(credentials.tokenEndpoint || (await discoverTokenEndpoint()))
	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: XAI_OAUTH_CONFIG.clientId,
			refresh_token: credentials.refresh_token,
		}).toString(),
		signal: AbortSignal.timeout(30_000),
	})
	if (!response.ok) {
		throw new Error(`xAI token refresh failed (HTTP ${response.status}): ${await responseError(response)}`)
	}
	const tokens = tokenResponseSchema.parse(await response.json())
	return {
		...credentials,
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token || credentials.refresh_token,
		id_token: tokens.id_token || credentials.id_token,
		token_type: tokens.token_type || credentials.token_type || "Bearer",
		tokenEndpoint,
		expires: Date.now() + tokens.expires_in * 1000,
	}
}

export class XAIOAuthManager {
	private credentials: XAIOAuthCredentials | null = null
	private refreshPromise: Promise<XAIOAuthCredentials> | null = null
	private pendingAuthorization: AbortController | null = null

	async loadCredentials(): Promise<XAIOAuthCredentials | null> {
		try {
			const stored = StateManager.get().getSecretKey(XAI_OAUTH_CREDENTIALS_KEY)
			this.credentials = stored ? xaiOAuthCredentialsSchema.parse(JSON.parse(stored)) : null
			return this.credentials
		} catch (error) {
			Logger.error("[xai-oauth] Failed to load credentials:", error)
			this.credentials = null
			return null
		}
	}

	async saveCredentials(credentials: XAIOAuthCredentials): Promise<void> {
		const stateManager = StateManager.get()
		stateManager.setSecret(XAI_OAUTH_CREDENTIALS_KEY, JSON.stringify(credentials))
		await stateManager.flushPendingState()
		this.credentials = credentials
	}

	async clearCredentials(): Promise<void> {
		const stateManager = StateManager.get()
		stateManager.setSecret(XAI_OAUTH_CREDENTIALS_KEY, undefined)
		await stateManager.flushPendingState()
		this.credentials = null
	}

	async isAuthenticated(): Promise<boolean> {
		return !!(this.credentials || (await this.loadCredentials()))
	}

	async getAccessToken(): Promise<string | null> {
		if (!this.credentials) await this.loadCredentials()
		if (!this.credentials) return null

		if (Date.now() >= this.credentials.expires - REFRESH_BUFFER_MS) {
			try {
				this.refreshPromise ||= refreshCredentials(this.credentials)
				await this.saveCredentials(await this.refreshPromise)
			} catch (error) {
				Logger.error("[xai-oauth] Failed to refresh access token:", error)
				return null
			} finally {
				this.refreshPromise = null
			}
		}
		return this.credentials.access_token
	}

	async startAuthorizationFlow(): Promise<{
		verificationUrl: string
		userCode: string
		completion: Promise<XAIOAuthCredentials>
	}> {
		this.cancelAuthorizationFlow()
		const [tokenEndpoint, device] = await Promise.all([discoverTokenEndpoint(), requestDeviceCode()])
		const controller = new AbortController()
		this.pendingAuthorization = controller
		const completion = pollForTokens(device.device_code, tokenEndpoint, device.expires_in, device.interval, controller.signal)
			.then(async (credentials) => {
				await this.saveCredentials(credentials)
				return credentials
			})
			.finally(() => {
				if (this.pendingAuthorization === controller) this.pendingAuthorization = null
			})

		return {
			verificationUrl: device.verification_uri_complete || device.verification_uri,
			userCode: device.user_code,
			completion,
		}
	}

	cancelAuthorizationFlow(): void {
		this.pendingAuthorization?.abort()
		this.pendingAuthorization = null
	}
}

export const xaiOAuthManager = new XAIOAuthManager()
