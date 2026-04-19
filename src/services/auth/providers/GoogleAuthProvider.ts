import * as crypto from "crypto"
import { type Credentials, OAuth2Client } from "google-auth-library"
import { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { type DietCodeAccountUserInfo, type DietCodeAuthInfo } from "../AuthService"
import { parseJwtPayload } from "../oca/utils/utils"
import { IAuthProvider } from "./IAuthProvider"

//  OAuth Client ID used to initiate OAuth2Client class.
//  Using the same ID as Gemini CLI for consistency, as per plan.
const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || ""
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""

const OAUTH_SCOPE = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
]

export class GoogleAuthProvider implements IAuthProvider {
	readonly name = "google"
	readonly tokenPrefix = "google"
	private _client: OAuth2Client

	constructor() {
		this._client = new OAuth2Client({
			clientId: OAUTH_CLIENT_ID,
			clientSecret: OAUTH_CLIENT_SECRET,
		})
	}

	async getAuthRequest(controller: Controller, callbackUrl: string): Promise<string> {
		const state = crypto.randomBytes(16).toString("hex")
		// Save the state in secure storage for verification during callback
		controller.stateManager.setSecret("dietcode:googleOAuthState", state)

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
			// CRITICAL: Verify OAuth state to prevent CSRF
			const storedState = controller.stateManager.getSecretKey("dietcode:googleOAuthState")
			if (state && storedState && state !== storedState) {
				throw new Error("OAuth state mismatch. Potential CSRF attack detected.")
			}
			// Cleanup state after verification
			controller.stateManager.setSecret("dietcode:googleOAuthState", undefined)

			const callbackUrl = await HostProvider.get().getCallbackUrl("/auth")
			const { tokens } = await this._client.getToken({
				code: authorizationCode,
				redirect_uri: callbackUrl,
			})

			this._client.setCredentials(tokens)

			const userInfo = await this.fetchUserInfo(tokens)

			const authInfo: DietCodeAuthInfo = {
				idToken: tokens.id_token || tokens.access_token || "",
				refreshToken: tokens.refresh_token || undefined,
				expiresAt: tokens.expiry_date ? tokens.expiry_date / 1000 : undefined,
				userInfo,
				provider: this.name,
				startedAt: Date.now(),
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
		return expiresAt < now + 300 // Refresh if expiring in less than 5 minutes
	}

	async refreshToken(refreshToken: string, storedData: DietCodeAuthInfo): Promise<DietCodeAuthInfo> {
		try {
			this._client.setCredentials({
				refresh_token: refreshToken,
			})

			const { credentials: tokens } = await this._client.refreshAccessToken()

			const authInfo: DietCodeAuthInfo = {
				...storedData,
				idToken: tokens.id_token || tokens.access_token || "",
				refreshToken: tokens.refresh_token || refreshToken,
				expiresAt: tokens.expiry_date ? tokens.expiry_date / 1000 : undefined,
			}

			return authInfo
		} catch (error) {
			Logger.error("GoogleAuthProvider: Error refreshing token:", error)
			throw error
		}
	}

	timeUntilExpiry(jwt: string): number {
		const payload = parseJwtPayload<any>(jwt)
		if (!payload || !payload.exp) return 0
		return payload.exp - Date.now() / 1000
	}

	async retrieveDietCodeAuthInfo(controller: Controller): Promise<DietCodeAuthInfo | null> {
		const stored = controller.stateManager.getSecretKey("dietcode:googleAuthInfo")
		if (!stored) return null

		try {
			const authInfo: DietCodeAuthInfo = JSON.parse(stored)

			if (authInfo.refreshToken && (await this.shouldRefreshIdToken(authInfo.refreshToken, authInfo.expiresAt))) {
				const updated = await this.refreshToken(authInfo.refreshToken, authInfo)
				controller.stateManager.setSecret("dietcode:googleAuthInfo", JSON.stringify(updated))
				return updated
			}

			return authInfo
		} catch (error) {
			Logger.error("GoogleAuthProvider: Error restoring auth info:", error)
			return null
		}
	}

	private async fetchUserInfo(tokens: Credentials): Promise<DietCodeAccountUserInfo> {
		const idToken = tokens.id_token
		if (!idToken) {
			throw new Error("No ID token received from Google")
		}

		const payload = parseJwtPayload<any>(idToken)
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
		controller.stateManager.setSecret("dietcode:googleAuthInfo", undefined)
		controller.stateManager.setSecret("dietcode:googleOAuthState", undefined)
	}
}
