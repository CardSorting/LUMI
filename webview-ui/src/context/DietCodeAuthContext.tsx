import { DEFAULT_STALE_AFTER_MS } from "@shared/grpc/persistent-stream"
import type { AuthState, UserOrganization } from "@shared/proto/dietcode/account"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import deepEqual from "fast-deep-equal"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useGrpcSubscription } from "@/hooks/useGrpcSubscription"
import { AccountServiceClient } from "@/services/grpc-client"

const EMPTY_REQUEST = EmptyRequest.create({})

// Define User type (you may need to adjust this based on your actual User type)
export interface DietCodeUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
	appBaseUrl?: string
}

export interface DietCodeAuthContextType {
	dietcodeUser: DietCodeUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
}

export const DietCodeAuthContext = createContext<DietCodeAuthContextType | undefined>(undefined)

export const DietCodeAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<DietCodeUser | null>(null)
	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[] | null>(null)

	const getUserOrganizations = useCallback(async () => {
		try {
			const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
			setUserOrganizations((old) => {
				if (!deepEqual(response.organizations, old)) {
					return response.organizations
				}

				return old
			})
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
		}
	}, [])

	const activeOrganization = useMemo(() => {
		return userOrganizations?.find((org) => org.active) ?? null
	}, [userOrganizations])

	useEffect(() => {
		console.log("Extension: DietCodeAuthContext: user updated:", user?.uid)
	}, [user?.uid])

	// Handle auth status update events with auto-reconnect
	useGrpcSubscription<typeof EMPTY_REQUEST, AuthState>({
		key: "authStatus",
		debugLabel: "Auth Status",
		subscribe: AccountServiceClient.subscribeToAuthStatusUpdate.bind(AccountServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: DEFAULT_STALE_AFTER_MS,
		onMessage: (response) => {
			setUser((oldUser) => {
				if (!response?.user?.uid) {
					return null
				}

				if (response?.user && oldUser?.uid !== response.user.uid) {
					getUserOrganizations()
					return response.user
				}

				return oldUser
			})
		},
	})

	return (
		<DietCodeAuthContext.Provider
			value={{
				dietcodeUser: user,
				organizations: userOrganizations,
				activeOrganization,
			}}>
			{children}
		</DietCodeAuthContext.Provider>
	)
}

export const useDietCodeAuth = () => {
	const context = useContext(DietCodeAuthContext)
	if (context === undefined) {
		throw new Error("useDietCodeAuth must be used within a DietCodeAuthProvider")
	}
	return context
}

export const useDietCodeSignIn = () => {
	const [isLoading, setIsLoading] = useState(false)

	const handleSignIn = useCallback(() => {
		try {
			setIsLoading(true)

			AccountServiceClient.accountLoginClicked(EmptyRequest.create())
				.catch((err) => console.error("Failed to get login URL:", err))
				.finally(() => {
					setIsLoading(false)
				})
		} catch (error) {
			console.error("Error signing in:", error)
		}
	}, [])

	return {
		isLoginLoading: isLoading,
		handleSignIn,
	}
}

export const handleSignOut = async () => {
	try {
		await AccountServiceClient.accountLogoutClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to logout:", err),
		)
	} catch (error) {
		console.error("Error signing out:", error)
		throw error
	}
}
