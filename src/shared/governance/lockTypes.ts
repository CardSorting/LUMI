/** Shared lock claim types — safe for webview and extension (no core imports). */

export interface LockBackends {
	inProcess: boolean
	swarmMutex: boolean
	roadmapLease: boolean
	fileLock: boolean
	broccoliFence: boolean
}

export type CoordinationAuthorityMode = "sqlite" | "local_test"

export interface LockClaim {
	claimId: string
	resourceKey: string
	ownerId: string
	fencingToken: string
	leaseEpoch: string
	authorityMode: CoordinationAuthorityMode
	roadmapLeaseTaskId?: string
	acquiredAt: number
	releasedAt?: number
	backends: LockBackends
}
