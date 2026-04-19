import { String } from "@shared/proto/dietcode/common"
import { DietCodeEnv } from "@/config"
import { Controller } from "@/core/controller"
import { setWelcomeViewCompleted } from "@/core/controller/state/setWelcomeViewCompleted"
import { WebviewProvider } from "@/core/webview"
import { DIETCODE_API_ENDPOINT } from "@/shared/dietcode/api"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { BannerService } from "../banner/BannerService"
import { buildBasicDietCodeHeaders } from "../EnvUtils"
import { AuthService } from "./AuthService"

export class AuthServiceMock extends AuthService {
	protected constructor(controller: Controller) {
		super(controller)

		if (process?.env?.DIETCODE_ENVIRONMENT !== "local" && process?.env?.CLINE_ENVIRONMENT !== "local") {
			throw new Error("AuthServiceMock should only be used in local environment for testing purposes.")
		}

		this._controller = controller
	}

	/**
	 * Gets the singleton instance of AuthServiceMock.
	 */
	public static override getInstance(controller?: Controller): AuthServiceMock {
		if (!AuthServiceMock.instance) {
			if (!controller) {
				Logger.error("Extension controller was not provided to AuthServiceMock.getInstance")
				throw new Error("Extension controller was not provided to AuthServiceMock.getInstance")
			}
			AuthServiceMock.instance = new AuthServiceMock(controller)
			// Initialize BannerService after AuthService is created
			BannerService.initialize(controller)
		}
		if (controller !== undefined) {
			AuthServiceMock.instance.controller = controller
		}
		return AuthServiceMock.instance
	}

	override async getAuthToken(): Promise<string | null> {
		if (!this._dietcodeAuthInfo) {
			return null
		}
		return this._dietcodeAuthInfo.idToken
	}

	override async createAuthRequest(): Promise<String> {
		// Use URL object for more graceful query construction
		const authUrl = new URL(DietCodeEnv.config().apiBaseUrl)
		const authUrlString = authUrl.toString()
		// Call the parent implementation
		if (this._authenticated && this._dietcodeAuthInfo) {
			Logger.log("Already authenticated with mock server")
			return String.create({ value: authUrlString })
		}

		try {
			// Use token exchange endpoint like DietCodeAuthProvider
			const tokenExchangeUri = new URL(DIETCODE_API_ENDPOINT.TOKEN_EXCHANGE, DietCodeEnv.config().apiBaseUrl)
			const tokenType = "personal"
			const testCode = `test-${tokenType}-token`

			const response = await fetch(tokenExchangeUri, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(await buildBasicDietCodeHeaders()),
				},
				body: JSON.stringify({
					code: testCode,
					grantType: "authorization_code",
				}),
			})

			if (!response.ok) {
				throw new Error(`Mock server authentication failed: ${response.status} ${response.statusText}`)
			}

			const responseData = await response.json()

			if (!responseData.success || !responseData.data) {
				throw new Error("Invalid response from mock server")
			}

			const authData = responseData.data

			// Convert to DietCodeAuthInfo format matching DietCodeAuthProvider
			this._dietcodeAuthInfo = {
				idToken: authData.accessToken,
				refreshToken: authData.refreshToken,
				expiresAt: new Date(authData.expiresAt).getTime() / 1000,
				userInfo: {
					id: authData.userInfo.dietcodeUserId || authData.userInfo.subject,
					email: authData.userInfo.email,
					displayName: authData.userInfo.name,
					createdAt: new Date().toISOString(),
					organizations: authData.organizations,
					appBaseUrl: DietCodeEnv.config().appBaseUrl,
					subject: authData.userInfo.subject,
				},
				provider: this.provider?.name || "mock",
			}

			Logger.log(`Successfully authenticated with mock server as ${authData.userInfo.name} (${authData.userInfo.email})`)

			const visibleWebview = WebviewProvider.getVisibleInstance()

			// Use appropriate provider name for callback
			const providerName = this.provider?.name || "mock"
			// Simulate handling the auth callback as if from a real provider
			await visibleWebview?.controller.handleAuthCallback(authData.accessToken, providerName)
		} catch (error) {
			Logger.error("Error signing in with mock server:", error)
			this._authenticated = false
			this._dietcodeAuthInfo = null
			throw error
		}

		return String.create({ value: authUrlString })
	}

	override async handleAuthCallback(_token: string, _provider: string): Promise<void> {
		try {
			this._authenticated = true
			await setWelcomeViewCompleted(this._controller, { value: true })
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("Error signing in with custom token:", error)
			throw error
		}
	}

	override async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		try {
			if (this._dietcodeAuthInfo) {
				this._authenticated = true
				await this.sendAuthStatusUpdate()
			} else {
				Logger.warn("No user found after restoring auth token")
				this._authenticated = false
				this._dietcodeAuthInfo = null
			}
		} catch (error) {
			Logger.error("Error restoring auth token:", error)
			this._authenticated = false
			this._dietcodeAuthInfo = null
			return
		}
	}
}
