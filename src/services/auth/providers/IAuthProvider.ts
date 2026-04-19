import { Controller } from "@/core/controller"
import { DietCodeAuthInfo } from "../AuthService"

export interface IAuthProvider {
	readonly name: string
	readonly tokenPrefix?: string

	/**
	 * Returns the authorization request URL to start the login flow.
	 */
	getAuthRequest(controller: Controller, callbackUrl: string): Promise<string>

	/**
	 * Exchanges the authorization code for tokens.
	 */
	signIn(controller: Controller, authorizationCode: string, provider: string): Promise<DietCodeAuthInfo | null>

	/**
	 * Checks if the ID token should be refreshed.
	 */
	shouldRefreshIdToken(refreshToken: string, expiresAt?: number): Promise<boolean>

	/**
	 * Refreshes the ID token using the refresh token.
	 */
	refreshToken(refreshToken: string, storedData: DietCodeAuthInfo): Promise<DietCodeAuthInfo>

	/**
	 * Returns the time in seconds until the token expires.
	 */
	timeUntilExpiry(jwt: string): number

	/**
	 * Restores auth info from storage and refreshes if necessary.
	 */
	retrieveDietCodeAuthInfo(controller: Controller): Promise<DietCodeAuthInfo | null>
	getAccessToken(controller: Controller): Promise<string | null>
}
