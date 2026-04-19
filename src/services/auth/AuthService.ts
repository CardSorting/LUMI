import { AuthState, UserInfo } from "@shared/proto/dietcode/account"
import { type EmptyRequest, String } from "@shared/proto/dietcode/common"
import { DietCodeEnv } from "@/config"
import { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { setWelcomeViewCompleted } from "@/core/controller/state/setWelcomeViewCompleted"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { BannerService } from "../banner/BannerService"
import { AuthInvalidTokenError, AuthNetworkError } from "../error/DietCodeError"
import { featureFlagsService } from "../feature-flags"
import { DietCodeAuthProvider } from "./providers/DietCodeAuthProvider"
import { GoogleAuthProvider } from "./providers/GoogleAuthProvider"
import { IAuthProvider } from "./providers/IAuthProvider"
import { LogoutReason } from "./types"

export type ServiceConfig = {
	URI?: string
	[key: string]: any
}

export interface DietCodeAuthInfo {
	/**
	 * accessToken
	 */
	idToken: string
	/**
	 * Short-lived refresh token
	 */
	refreshToken?: string
	/**
	 * Access token expiration time
	 * When expired, the access token needs to be refreshed using the refresh token.
	 */
	expiresAt?: number
	userInfo: DietCodeAccountUserInfo
	provider: string
	startedAt?: number
}

export interface DietCodeAccountUserInfo {
	createdAt: string
	displayName: string
	email: string
	id: string
	organizations: DietCodeAccountOrganization[]
	/**
	 * DietCode app base URL, used for webview UI and other client-side operations
	 */
	appBaseUrl?: string
	/**
	 * WorkOS IDP ID if user logged in via SSO
	 */
	subject?: string
}

export interface DietCodeAccountOrganization {
	active: boolean
	memberId: string
	name: string
	organizationId: string
	roles: string[]
}

export class AuthService {
	protected static instance: AuthService | null = null
	protected _authenticated = false
	protected _dietcodeAuthInfo: DietCodeAuthInfo | null = null
	protected _providers: Map<string, IAuthProvider>
	protected _activeProviderName = "dietcode"
	protected _activeAuthStatusUpdateHandlers = new Set<StreamingResponseHandler<AuthState>>()
	protected _handlerToController = new Map<StreamingResponseHandler<AuthState>, Controller>()
	protected _controller: Controller
	protected _refreshPromise: Promise<string | undefined> | null = null

	/**
	 * Creates an instance of AuthService.
	 * @param controller - Optional reference to the Controller instance.
	 */
	protected constructor(controller: Controller) {
		this._providers = new Map<string, IAuthProvider>([
			["dietcode", new DietCodeAuthProvider()],
			["google", new GoogleAuthProvider()],
		])
		this._controller = controller
	}

	get provider(): IAuthProvider {
		return this._providers.get(this._activeProviderName) || this._providers.get("dietcode")!
	}

	/**
	 * Gets the singleton instance of AuthService.
	 * @param controller - Optional reference to the Controller instance.
	 * @returns The singleton instance of AuthService.
	 */
	public static getInstance(controller?: Controller): AuthService {
		if (!AuthService.instance) {
			if (!controller) {
				Logger.warn("Extension context was not provided to AuthService.getInstance, using default context")
				controller = {} as Controller
			}
			if (process.env.E2E_TEST) {
				// Use require instead of import to avoid circular dependency issues
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { AuthServiceMock } = require("./AuthServiceMock")
				AuthService.instance = AuthServiceMock.getInstance(controller)
			} else {
				AuthService.instance = new AuthService(controller)
			}
			// Initialize BannerService after AuthService is created
			BannerService.initialize(controller)
		}
		if (controller !== undefined && AuthService.instance) {
			AuthService.instance.controller = controller
		}
		return AuthService.instance!
	}

	set controller(controller: Controller) {
		this._controller = controller
	}

	/**
	 * Returns the current authentication token with the appropriate prefix.
	 * Refreshing it if necessary.
	 * @param providerName Optional provider name to get a token for. If not provided, uses the active provider.
	 */
	async getAuthToken(providerName?: string): Promise<string | null> {
		if (providerName) {
			const provider = this._providers.get(providerName)
			if (!provider) {
				return null
			}
			// If it's the current active provider, use the standard flow
			if (providerName === this.provider.name) {
				const token = await this.internalGetAuthToken(provider)
				if (!token) return null
				const prefix = provider.tokenPrefix
				return prefix ? `${prefix}:${token}` : token
			}
			// Otherwise, use the provider's own access token retrieval (e.g. for Google Personal)
			return provider.getAccessToken(this._controller)
		}

		const token = await this.internalGetAuthToken(this.provider)
		if (!token) {
			return null
		}
		const prefix = this.provider.tokenPrefix
		return prefix ? `${prefix}:${token}` : token
	}

	/**
	 * Gets the active organization ID from the authenticated user's info
	 * @returns The active organization ID, or null if no active organization exists
	 */
	getActiveOrganizationId(): string | null {
		if (!this._dietcodeAuthInfo?.userInfo?.organizations) {
			return null
		}
		const activeOrg = this._dietcodeAuthInfo.userInfo.organizations.find((org) => org.active)
		return activeOrg?.organizationId ?? null
	}

	/**
	 * Gets all organizations from the authenticated user's info
	 * @returns Array of organizations, or undefined if not available
	 */
	getUserOrganizations(): DietCodeAccountOrganization[] | undefined {
		return this._dietcodeAuthInfo?.userInfo?.organizations
	}

	private async internalGetAuthToken(provider: IAuthProvider): Promise<string | null> {
		try {
			let dietcodeAccountAuthToken = this._dietcodeAuthInfo?.idToken
			if (!this._dietcodeAuthInfo || !dietcodeAccountAuthToken || this._dietcodeAuthInfo.provider !== provider.name) {
				// Not authenticated
				return null
			}

			// Check if token has expired
			if (await provider.shouldRefreshIdToken(dietcodeAccountAuthToken, this._dietcodeAuthInfo.expiresAt)) {
				// If a refresh is already in progress, wait for it to complete
				if (this._refreshPromise) {
					Logger.info("Token refresh already in progress, waiting for completion")
					const updatedToken = await this._refreshPromise
					return updatedToken || null
				}

				// Start a new refresh operation
				this._refreshPromise = (async () => {
					let authStatusChanged = false

					try {
						const updatedAuthInfo = await provider.retrieveDietCodeAuthInfo(this._controller)
						if (updatedAuthInfo) {
							this._dietcodeAuthInfo = updatedAuthInfo
							this._authenticated = true
							dietcodeAccountAuthToken = updatedAuthInfo.idToken
							authStatusChanged = true
						}
					} catch (error) {
						// Only log out for permanent auth failures, not network issues
						if (error instanceof AuthInvalidTokenError) {
							Logger.error("Token is invalid or expired:", error)
							this._dietcodeAuthInfo = null
							this._authenticated = false
							telemetryService.captureAuthLoggedOut(this.provider.name, LogoutReason.ERROR_RECOVERY)
							authStatusChanged = true
						} else if (error instanceof AuthNetworkError) {
							Logger.error("Network error refreshing token", error)
							// Keep existing auth info, will retry on next getAuthToken() call
						} else {
							throw error // Re-throw unexpected errors
						}
					} finally {
						this._refreshPromise = null
					}

					// Defer auth status update to avoid infinite loop
					if (authStatusChanged) {
						setImmediate(() => {
							this.sendAuthStatusUpdate().catch((error) => {
								Logger.error("Error sending auth status update after token refresh:", error)
							})
						})
					}

					return dietcodeAccountAuthToken
				})()

				dietcodeAccountAuthToken = await this._refreshPromise
			}

			return dietcodeAccountAuthToken || null
		} catch (error) {
			Logger.error("Error getting auth token:", error)
			return null
		}
	}

	/**
	 * Gets the provider name for the current authentication
	 * @returns The provider name (e.g., "dietcode", "firebase"), or null if not authenticated
	 */
	getProviderName(): string | null {
		return this._dietcodeAuthInfo?.provider ?? null
	}

	async getProviderUserInfo(providerName: string): Promise<DietCodeAccountUserInfo | null> {
		const provider = this._providers.get(providerName)
		if (!provider) return null

		const authInfo = await provider.retrieveDietCodeAuthInfo(this._controller)
		return authInfo?.userInfo || null
	}

	getInfo(): AuthState {
		// TODO: this logic should be cleaner, but this will determine the authentication state for the webview -- if a user object is returned then the webview assumes authenticated, otherwise it assumes logged out (we previously returned a UserInfo object with empty fields, and this represented a broken logged in state)
		let user: any = null
		if (this._dietcodeAuthInfo && this._authenticated) {
			const userInfo = this._dietcodeAuthInfo.userInfo
			this._dietcodeAuthInfo.userInfo.appBaseUrl = DietCodeEnv.config()?.appBaseUrl

			user = UserInfo.create({
				// TODO: create proto for new user info type
				uid: userInfo?.id,
				displayName: userInfo?.displayName,
				email: userInfo?.email,
				photoUrl: undefined,
				appBaseUrl: userInfo?.appBaseUrl,
			})
		}

		return AuthState.create({
			user,
		})
	}

	async createAuthRequest(strict = false, providerName?: string): Promise<String> {
		// In strict mode, we do not open a new auth window if already authenticated
		if (strict && this._authenticated && (!providerName || providerName === this.provider.name)) {
			this.sendAuthStatusUpdate()
			return String.create({ value: "Already authenticated" })
		}

		const callbackUrl = await HostProvider.get().getCallbackUrl("/auth")
		const provider = providerName ? this._providers.get(providerName) : this.provider
		if (!provider) {
			throw new Error(`Provider ${providerName} not found`)
		}

		const authUrl = await provider.getAuthRequest(this._controller, callbackUrl)
		const authUrlString = authUrl.toString()

		await openExternal(authUrlString)
		telemetryService.captureAuthStarted(provider.name)
		return String.create({ value: authUrlString })
	}

	async handleDeauth(reason: LogoutReason = LogoutReason.UNKNOWN): Promise<void> {
		try {
			telemetryService.captureAuthLoggedOut(this.provider.name, reason)
			this._dietcodeAuthInfo = null
			this._authenticated = false
			this.destroyTokens()
			this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("Error signing out:", error)
			throw error
		}
	}

	async signOutProvider(providerName: string): Promise<void> {
		try {
			Logger.info(`Signing out from provider: ${providerName}`)
			const provider = this._providers.get(providerName)
			if (provider) {
				// Provider specific cleanup if implemented
				if ("signOut" in provider && typeof provider.signOut === "function") {
					await (provider as any).signOut(this._controller)
				}
			}

			// Force clear the specific token from storage
			const key = providerName === "google" ? "dietcode:googleAuthInfo" : "dietcode:dietcodeAccountId"
			this._controller.stateManager.setSecret(key as any, undefined)

			if (this._activeProviderName === providerName) {
				this._dietcodeAuthInfo = null
				this._authenticated = false
				this._activeProviderName = "dietcode"
			}

			this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error(`Error signing out from ${providerName}:`, error)
		}
	}

	async handleAuthCallback(authorizationCode: string, providerName: string, state: string | null = null): Promise<void> {
		try {
			const provider = this._providers.get(providerName) || this.provider
			this._activeProviderName = provider.name
			this._dietcodeAuthInfo = await provider.signIn(this._controller, authorizationCode, providerName, state ?? undefined)
			this._authenticated = this._dietcodeAuthInfo?.idToken !== undefined

			telemetryService.captureAuthSucceeded(this.provider.name)
			await setWelcomeViewCompleted(this._controller, { value: true })
		} catch (error) {
			Logger.error("Error signing in with custom token:", error)
			telemetryService.captureAuthFailed(this.provider.name)
			throw error
		} finally {
			await this.sendAuthStatusUpdate()
		}
	}

	/**
	 * @deprecated Use handleDeauth() instead. Storage clearing is now handled consistently within the auth domain.
	 * Clear the authentication token from the extension's storage.
	 * This is typically called when the user logs out.
	 */
	async clearAuthToken(): Promise<void> {
		this.destroyTokens()
	}

	/**
	 * Restores the authentication data from the extension's storage.
	 * This is typically called when the extension is activated.
	 */
	async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		try {
			// Try to restore session from any available provider
			for (const [name, provider] of this._providers) {
				this._dietcodeAuthInfo = await provider.retrieveDietCodeAuthInfo(this._controller)
				if (this._dietcodeAuthInfo) {
					this._activeProviderName = name
					this._authenticated = true
					await this.sendAuthStatusUpdate()
					return
				}
			}

			Logger.warn("No user found after restoring auth token")
			this._authenticated = false
			this._dietcodeAuthInfo = null
			telemetryService.captureAuthLoggedOut(this.provider.name, LogoutReason.ERROR_RECOVERY)
		} catch (error) {
			Logger.error("Error restoring auth token:", error)
			this._authenticated = false
			this._dietcodeAuthInfo = null
			telemetryService.captureAuthLoggedOut(this.provider.name, LogoutReason.ERROR_RECOVERY)
			return
		}
	}

	private async retrieveAuthInfo(): Promise<DietCodeAuthInfo | null> {
		// If a refresh is already in progress, wait for it to complete
		if (this._refreshPromise) {
			Logger.info("Token refresh already in progress, waiting for completion")
			await this._refreshPromise
		}

		return this.provider.retrieveDietCodeAuthInfo(this._controller)
	}

	/**
	 * Subscribe to authStatusUpdate events
	 * @param controller The controller instance
	 * @param request The empty request
	 * @param responseStream The streaming response handler
	 * @param requestId The ID of the request (passed by the gRPC handler)
	 */
	async subscribeToAuthStatusUpdate(
		controller: Controller,
		_request: EmptyRequest,
		responseStream: StreamingResponseHandler<AuthState>,
		requestId?: string,
	): Promise<void> {
		// Add this subscription to the active subscriptions
		this._activeAuthStatusUpdateHandlers.add(responseStream)
		this._handlerToController.set(responseStream, controller)
		// Register cleanup when the connection is closed
		const cleanup = () => {
			this._activeAuthStatusUpdateHandlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
		}
		// Register the cleanup function with the request registry if we have a requestId
		if (requestId) {
			getRequestRegistry().registerRequest(requestId, cleanup, { type: "authStatusUpdate_subscription" }, responseStream)
		}

		// Send the current authentication status immediately
		try {
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("Error sending initial auth status:", error)
			// Remove the subscription if there was an error
			this._activeAuthStatusUpdateHandlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
		}
	}

	/**
	 * Send an authStatusUpdate event to all active subscribers
	 */
	async sendAuthStatusUpdate(): Promise<void> {
		// Compute once per broadcast
		const authInfo: AuthState = this.getInfo()
		const uniqueControllers = new Set<Controller>()

		// Send the event to all active subscribers
		const streamSends = Array.from(this._activeAuthStatusUpdateHandlers).map(async (responseStream) => {
			const controller = this._handlerToController.get(responseStream)
			if (controller) {
				uniqueControllers.add(controller)
			}
			try {
				await responseStream(
					authInfo,
					false, // Not the last message
				)
			} catch (error) {
				Logger.error("Error sending authStatusUpdate event:", error)
				// Remove the subscription if there was an error
				this._activeAuthStatusUpdateHandlers.delete(responseStream)
				this._handlerToController.delete(responseStream)
			}
		})

		await Promise.all(streamSends)

		// Identify the user in telemetry if available
		if (this._dietcodeAuthInfo?.userInfo?.id) {
			telemetryService.identifyAccount(this._dietcodeAuthInfo.userInfo)
			// Poll feature flags immediately for authenticated users to ensure cache is populated
			await featureFlagsService.poll(this._dietcodeAuthInfo.userInfo?.id)
		} else {
			// Poll feature flags for unauthenticated state
			await featureFlagsService.poll(null)
		}

		// Update banners based on new auth token
		BannerService.onAuthUpdate(this._dietcodeAuthInfo?.userInfo?.id || null).catch((error) => {
			Logger.error("[AuthService] Banner update failed", error)
		})

		// Update state in webviews once per unique controller
		await Promise.all(Array.from(uniqueControllers).map((c) => c.postStateToWebview()))
	}

	private destroyTokens() {
		this._controller.stateManager.setSecret("dietcodeAccountId", undefined)
		this._controller.stateManager.setSecret("dietcode:dietcodeAccountId", undefined)
		this._controller.stateManager.setSecret("dietcode:googleAuthInfo", undefined)
	}
}
