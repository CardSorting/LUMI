/**
 * [LAYER: CORE]
 * JoyRide is a bounded execution cache substrate for active task hot paths.
 */

export const JOYRIDE_CACHE_KINDS = ["hotExecution", "taskLocal", "workspaceIndex", "verification", "scratchArtifact"] as const

export type JoyRideCacheKind = (typeof JOYRIDE_CACHE_KINDS)[number]

export type JoyRideDurability = "memoryOnly" | "spillable" | "persistedDiagnostic" | "persistedReceipt"

export type JoyRideSafetyClassification = "public" | "workspace" | "taskLocal" | "sensitive" | "unsafe"

export type JoyRideInvalidationReason =
	| "ttl_expired"
	| "task_boundary_changed"
	| "task_completed"
	| "task_cancelled"
	| "task_scope_changed"
	| "workspace_closed"
	| "workspace_drift"
	| "workspace_generation_changed"
	| "workspace_fingerprint_changed"
	| "file_hash_changed"
	| "git_head_changed"
	| "dependency_fingerprint_changed"
	| "lockfile_fingerprint_changed"
	| "command_environment_changed"
	| "approval_boundary_changed"
	| "runtime_version_changed"
	| "tool_version_changed"
	| "config_changed"
	| "security_policy_changed"
	| "manual_flush"
	| "manual_stale_mark"
	| "validation_required"
	| "validation_failed"
	| "memory_pressure"
	| "emergency_pressure"
	| "entry_replaced"

export type JoyRideCacheScope =
	| { type: "task"; id: string }
	| { type: "workspace"; id: string }
	| { type: "verification"; id: string }
	| { type: "scratch"; id: string }

export interface JoyRideValidationFingerprint {
	fingerprint?: string
	workspaceFingerprint?: string
	approvalBoundaryId?: string
	generation?: number
	dependencyFingerprint?: string
	lockfileFingerprint?: string
	gitHead?: string
	environmentFingerprint?: string
	runtimeVersion?: string
	toolVersion?: string
	relevantFileHashes?: Record<string, string>
}

export interface JoyRideSetMetadata extends JoyRideValidationFingerprint {
	cacheKind: JoyRideCacheKind
	scope: JoyRideCacheScope
	ownerTaskId: string
	ttlMs: number
	estimatedBytes?: number
	fingerprint: string
	workspaceFingerprint: string
	approvalBoundaryId: string
	durability?: JoyRideDurability
	invalidationReason: JoyRideInvalidationReason[]
	cleanupHandler?: JoyRideCleanupHandler
	admissionReason: string
	safetyClassification: JoyRideSafetyClassification
	generation: number
}

export type JoyRideCleanupHandler = (entry: JoyRideCacheEntry<unknown>) => void | Promise<void>

export interface JoyRideCacheEntry<T = unknown> {
	key: string
	value: T
	cacheKind: JoyRideCacheKind
	scope: JoyRideCacheScope
	ownerTaskId: string
	createdAt: number
	lastAccessedAt: number
	ttl: number
	estimatedBytes: number
	fingerprint: string
	workspaceFingerprint: string
	approvalBoundaryId: string
	durability: JoyRideDurability
	invalidationReason: JoyRideInvalidationReason[]
	cleanupHandler: JoyRideCleanupHandler
	admissionReason: string
	staleReason?: JoyRideInvalidationReason | string
	accessCount: number
	generation: number
	safetyClassification: JoyRideSafetyClassification
	dependencyFingerprint?: string
	lockfileFingerprint?: string
	gitHead?: string
	environmentFingerprint?: string
	runtimeVersion?: string
	toolVersion?: string
	relevantFileHashes?: Record<string, string>
}

export interface JoyRideBudgetConfig {
	maxTotalBytes: number
	maxEntryBytes: number
	maxPerTaskBytes: number
	maxArtifactCount: number
	maxArtifactBytes: number
	perKindBudgetBytes: Record<JoyRideCacheKind, number>
	emergencyTargetRatio: number
}

export interface JoyRideSetResult {
	accepted: boolean
	key: string
	reason: string
	entry?: JoyRideCacheEntry<unknown>
}

export interface JoyRideTrimResult {
	trimmedEntries: number
	freedBytes: number
	reason: JoyRideInvalidationReason
}

export interface JoyRideInvalidateTarget {
	scope?: JoyRideCacheScope
	cacheKind?: JoyRideCacheKind
	ownerTaskId?: string
	workspaceFingerprint?: string
	approvalBoundaryId?: string
	reason?: JoyRideInvalidationReason
	predicate?: (entry: JoyRideCacheEntry<unknown>) => boolean
}

export interface JoyRideEntrySummary {
	key: string
	cacheKind: JoyRideCacheKind
	estimatedBytes: number
	ownerTaskId: string
	accessCount: number
	ageMs: number
}

export interface JoyRideCacheStats {
	hitCount: number
	missCount: number
	hitRate: number
	missRate: number
	evictionCount: number
	ttlEvictionCount: number
	lruEvictionCount: number
	staleInvalidationCount: number
	staleDiagnosticCount: number
	memoryUsageEstimate: number
	perCacheMemoryEstimate: Record<JoyRideCacheKind, number>
	perTaskMemoryEstimate: Record<string, number>
	artifactCount: number
	verificationCacheReuseCount: number
	pressureTrimEvents: number
	emergencyTrimEvents: number
	rejectedAdmissionCount: number
	rejectedUnsafeEntryCount: number
	rejectedOversizedEntryCount: number
	lateWriteRejectionCount: number
	cleanupFailureCount: number
	averageEntryAgeMs: number
	largestEntries: JoyRideEntrySummary[]
	hottestKeys: JoyRideEntrySummary[]
	staleReusePreventionCount: number
	taskCleanupCount: number
	scratchCleanupCount: number
	spillCount: number
	cacheValidationFailureCount: number
	duplicateArtifactDeduplicationCount: number
	entryCount: number
	cacheHitAuditCount: number
	lastFlushDurationMs: number
	lastShutdownDurationMs: number
	operationalMode: string
	isHelping: boolean
}

export type JoyRideCleanupStatus = "none" | "pending" | "completed" | "failed"

export interface JoyRideExplainResult {
	exists: boolean
	key: string
	cacheKind?: JoyRideCacheKind
	ownerTaskId?: string
	scope?: JoyRideCacheScope
	admissionReason?: string
	validity: "missing" | "valid" | "stale" | "expired"
	staleReason?: JoyRideInvalidationReason | string
	createdAt?: number
	lastAccessedAt?: number
	expiresAt?: number
	ttlMs?: number
	ageMs?: number
	estimatedBytes?: number
	canEvict?: boolean
	canReuse?: boolean
	reuseBlockReason?: string
	diagnosticOnly?: boolean
	invalidationTriggers?: JoyRideInvalidationReason[]
	durability?: JoyRideDurability
	safetyClassification?: JoyRideSafetyClassification
	invalidationReason?: JoyRideInvalidationReason[]
	workspaceFingerprint?: string
	approvalBoundaryId?: string
	generation?: number
	fingerprint?: string
	accessCount?: number
	cleanupStatus?: JoyRideCleanupStatus
}
