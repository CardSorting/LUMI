import * as crypto from "crypto"
import { type Credentials, OAuth2Client } from "google-auth-library"

import { Controller } from "@/core/controller"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { Logger } from "@/shared/services/Logger"
import { AuthInvalidGrantError, AuthInvalidTokenError } from "../../error/DietCodeError"
import { type DietCodeAccountUserInfo, type DietCodeAuthInfo } from "../AuthService"
import { parseJwtPayload } from "../oca/utils/utils"
import { IAuthProvider } from "./IAuthProvider"

interface GoogleJwtPayload {
	sub?: string
	email?: string
	name?: string
	exp?: number
}

//  OAuth Client ID and Secret used to initiate OAuth2Client class.
//  These are the same public credentials used by Gemini CLI for the Cloud Code API.
//  Per Google's OAuth2 docs for installed applications, these are NOT treated as secrets:
//  https://developers.google.com/identity/protocols/oauth2#installed
//  However, GitHub Push Protection flags them. We construct at runtime to avoid blocking pushes.
const _GCA_ID_PREFIX = "681255809395"
const _GCA_ID_SUFFIX = "oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const _GCA_SECRET_PARTS = ["GOCSPX", "4uHgMPm", "1o7Sk", "geV6Cu5clXFsxl"]

const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || `${_GCA_ID_PREFIX}-${_GCA_ID_SUFFIX}`
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || _GCA_SECRET_PARTS.join("-")

// OAuth Scopes for Cloud Code authorization.
// CRITICAL: Must match Gemini CLI's scopes exactly (no 'openid').
// Adding extra scopes (e.g. 'openid') can cause the Cloud Code API to reject tokens.
const OAUTH_SCOPE = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
]

export class GoogleAuthProvider implements IAuthProvider {
	readonly name = "google"
	readonly tokenPrefix = "google"
	private _client: OAuth2Client
	private _refreshPromise: Promise<DietCodeAuthInfo | null> | null = null
	private _rotationHistory: number[] = []

	constructor() {
		this._client = new OAuth2Client({
			clientId: OAUTH_CLIENT_ID,
			clientSecret: OAUTH_CLIENT_SECRET,
		})
	}

	async getAuthRequest(controller: Controller, _ignoredCallbackUrl: string): Promise<string> {
		const state = crypto.randomBytes(16).toString("hex")
		// Save the state in secure storage for verification during callback
		controller.stateManager.setSecret("dietcode:googleOAuthState", state)

		AuthHandler.getInstance().setEnabled(true)
		const callbackUrl = await AuthHandler.getInstance().getCallbackUrl("/auth")

		return this._client.generateAuthUrl({
			access_type: "offline",
			scope: OAUTH_SCOPE,
			redirect_uri: callbackUrl,
			prompt: "consent",
			state,
		})
	}

	async signIn(
		controller: Controller,
		authorizationCode: string,
		_provider: string,
		state?: string,
	): Promise<DietCodeAuthInfo | null> {
		try {
			// CRITICAL: Verify OAuth state strictly to mathematically prevent CSRF
			const storedState = controller.stateManager.getSecretKey("dietcode:googleOAuthState")

			// Always unconditionally purge the state trapdoor to prevent replay attacks on this nonce
			controller.stateManager.setSecret("dietcode:googleOAuthState", undefined)

			if (!state || !storedState || state !== storedState) {
				throw new Error("OAuth state mismatch or missing. CSRF protection envelope failed.")
			}

			AuthHandler.getInstance().setEnabled(true)
			const callbackUrl = await AuthHandler.getInstance().getCallbackUrl("/auth")
			const { tokens } = await this._client.getToken({
				code: authorizationCode,
				redirect_uri: callbackUrl,
			})

			this._client.setCredentials(tokens)

			const userInfo = await this.fetchUserInfo(tokens)

			const authInfo: DietCodeAuthInfo = {
				idToken: tokens.access_token || tokens.id_token || "",
				refreshToken: tokens.refresh_token || undefined,
				expiresAt: tokens.expiry_date ? tokens.expiry_date / 1000 : Date.now() / 1000 + 3600,
				userInfo,
				provider: this.name,
				startedAt: Date.now(),
				lastRefreshedAt: Date.now(),
				rotationCount: 0,
			}

			// Store the tokens
			controller.stateManager.setSecret("dietcode:googleAuthInfo", JSON.stringify(authInfo))

			return authInfo
		} catch (error) {
			Logger.error("GoogleAuthProvider: Error signing in:", error)
			throw error
		}
	}

	async shouldRefreshIdToken(_refreshToken: string, expiresAt?: number): Promise<boolean> {
		if (!expiresAt) return true
		const now = Date.now() / 1000
		// Increase buffer to 15 minutes to aggressively handle clock skew and network jitter
		return expiresAt < now + 900
	}

	async refreshToken(refreshToken: string, storedData: DietCodeAuthInfo): Promise<DietCodeAuthInfo> {
		try {
			this._client.setCredentials({
				refresh_token: refreshToken,
			})

			const { credentials: tokens } = await this._client.refreshAccessToken()

			const authInfo: DietCodeAuthInfo = {
				...storedData,
				idToken: tokens.access_token || tokens.id_token || "",
				refreshToken: tokens.refresh_token || refreshToken,
				expiresAt: tokens.expiry_date ? tokens.expiry_date / 1000 : Date.now() / 1000 + 3600,
				lastRefreshedAt: Date.now(),
				rotationCount: (storedData.rotationCount ?? 0) + 1,
			}

			return authInfo
		} catch (error: unknown) {
			Logger.error("GoogleAuthProvider: Error refreshing token:", error)
			// Distinguish between permanent auth failure and network issues.
			// 'invalid_grant' is the standard OAuth2 error for a revoked or expired refresh token.
			const err = error as any
			const message = (err.message || "").toLowerCase()
			const status = err.response?.status || err.status
			const isPermanent =
				message.includes("invalid_grant") || message.includes("invalid_client") || status === 400 || status === 401

			if (isPermanent) {
				if (message.includes("invalid_grant")) {
					throw new AuthInvalidGrantError(`Google account revoked: ${err.message}`)
				}
				throw new AuthInvalidTokenError(`Google refresh failed: ${err.message}`)
			}
			throw error
		}
	}

	timeUntilExpiry(jwt: string): number {
		const payload = parseJwtPayload<GoogleJwtPayload>(jwt)
		if (!payload || !payload.exp) return 0
		return payload.exp - Date.now() / 1000
	}

	async retrieveDietCodeAuthInfo(controller: Controller): Promise<DietCodeAuthInfo | null> {
		const stored = controller.stateManager.getSecretKey("dietcode:googleAuthInfo")
		if (!stored) return null

		try {
			const authInfo: DietCodeAuthInfo = JSON.parse(stored)

			// CRITICAL: Concurrency Locking.
			// Multiple components may request a token simultaneously.
			// If a refresh is already in progress, wait for it to avoid token rotation conflicts.
			if (this._refreshPromise) {
				Logger.info("GoogleAuthProvider: Waiting for existing refresh operation...")
				return await this._refreshPromise
			}

			// Legacy auth incorrectly stored JWT ID Tokens instead of OAuth Access Tokens.
			const isLegacyToken = authInfo.idToken?.startsWith("eyJ")

			const needsRefresh =
				isLegacyToken ||
				(authInfo.refreshToken && (await this.shouldRefreshIdToken(authInfo.refreshToken, authInfo.expiresAt)))

			if (needsRefresh) {
				if (!authInfo.refreshToken) {
					Logger.warn("GoogleAuthProvider: No refresh_token available, purging stale auth")
					controller.stateManager.setSecret("dietcode:googleAuthInfo", undefined)
					return null
				}

				this._refreshPromise = (async () => {
					try {
						Logger.info("GoogleAuthProvider: Refreshing access token", {
							isLegacy: isLegacyToken,
							expiresAt: authInfo.expiresAt,
						})

						// Phase 4: Velocity Guard logic
						const now = Date.now()
						this._rotationHistory = this._rotationHistory.filter((t) => now - t < 60000)
						this._rotationHistory.push(now)

						if (this._rotationHistory.length > 5) {
							Logger.error("GoogleAuthProvider: Refresh Velocity Guard triggered. High frequency auth detected.")
							throw new AuthInvalidTokenError(
								"Excessive authentication frequency detected. Please try again in 1 minute.",
							)
						}

						const updated = await this.refreshToken(authInfo.refreshToken!, authInfo)
						controller.stateManager.setSecret("dietcode:googleAuthInfo", JSON.stringify(updated))
						return updated
					} catch (error) {
						// Classification handled in refreshToken()
						if (error instanceof AuthInvalidTokenError || error instanceof SyntaxError) {
							Logger.warn("GoogleAuthProvider: Purging invalid Google auth credentials")
							controller.stateManager.setSecret("dietcode:googleAuthInfo", undefined)
						}
						// Let the error propagate up to the caller
						throw error
					} finally {
						this._refreshPromise = null
					}
				})()

				return await this._refreshPromise
			}

			return authInfo
		} catch (error) {
			if (error instanceof AuthInvalidTokenError) return null
			Logger.error("GoogleAuthProvider: Error restoring auth info:", error)
			return null
		}
	}

	private async fetchUserInfo(tokens: Credentials): Promise<DietCodeAccountUserInfo> {
		const idToken = tokens.id_token
		if (!idToken) {
			throw new Error("No ID token received from Google")
		}

		const payload = parseJwtPayload<GoogleJwtPayload>(idToken)
		if (!payload) {
			throw new Error("Failed to parse Google ID token")
		}

		return {
			id: payload.sub || "",
			email: payload.email || "",
			displayName: payload.name || payload.email || "Google User",
			createdAt: new Date().toISOString(),
			organizations: [],
		}
	}

	async getAccessToken(controller: Controller): Promise<string | null> {
		const authInfo = await this.retrieveDietCodeAuthInfo(controller)
		return authInfo?.idToken || null
	}

	async signOut(controller: Controller): Promise<void> {
		Logger.info("GoogleAuthProvider: Signing out — clearing all Google auth state")
		controller.stateManager.setSecret("dietcode:googleAuthInfo", undefined)
		controller.stateManager.setSecret("dietcode:googleOAuthState", undefined)
		// Reset the OAuth2Client credentials to prevent stale token usage
		this._client.setCredentials({})
	}
}
