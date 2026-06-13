/**
 * Enum defining different reasons why a user might be logged out
 * Used for telemetry tracking to understand logout patterns
 */
export enum LogoutReason {
	/** User explicitly clicked logout button in UI */
	USER_INITIATED = "user_initiated",
	/** Auth tokens were cleared in another VSCode window (cross-window sync) */
	CROSS_WINDOW_SYNC = "cross_window_sync",
	/** Auth provider encountered an error and cleared tokens */
	ERROR_RECOVERY = "error_recovery",
	/** Unknown or unspecified reason */
	UNKNOWN = "unknown",
}

/**
 * Auth data contracts.
 *
 * NOTE: These pure-data interfaces live in this leaf module (zero service
 * imports) so that lightweight consumers — e.g. telemetry providers that only
 * need the shape of user info — can import the type without dragging in the
 * heavyweight AuthService (which transitively imports the Controller). This
 * breaks the telemetry→auth→controller circular dependency. AuthService
 * re-exports these for backward compatibility.
 */

export type ServiceConfig = {
	URI?: string
	[key: string]: any
}

export interface DietCodeAccountOrganization {
	active: boolean
	memberId: string
	name: string
	organizationId: string
	roles: string[]
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
	lastRefreshedAt?: number
	rotationCount?: number
}
