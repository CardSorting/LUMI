/**
 * [LAYER: CORE]
 * Stable JoyRide reason-code vocabulary for decisions, logs, and bug reports.
 */

export const JOYRIDE_REASON = {
	// Hits
	HIT_COMMAND_SAFE_ALLOWLISTED: "hit.command.safeAllowlisted",
	HIT_SEARCH_WORKSPACE_FINGERPRINT: "hit.search.workspaceFingerprintMatched",
	HIT_VERIFICATION_COMPLETE_PROOF: "hit.verification.completeProofMatched",

	// Misses — config
	MISS_CONFIG_DISABLED: "miss.config.disabled",
	MISS_CONFIG_DIAGNOSTICS_ONLY: "miss.config.diagnosticsOnly",
	MISS_CONFIG_COMMAND_REUSE_DISABLED: "miss.config.commandReuseDisabled",
	MISS_CONFIG_VERIFICATION_CACHE_DISABLED: "miss.config.verificationCacheDisabled",
	MISS_CONFIG_SEARCH_CACHE_DISABLED: "miss.config.searchCacheDisabled",
	MISS_CACHE_DEGRADED: "miss.cacheDegraded",

	// Misses — command
	MISS_NO_ENTRY: "miss.noEntry",
	MISS_EXPIRED: "miss.expired",
	MISS_COMMAND_UNKNOWN: "miss.command.unknown",
	MISS_COMMAND_UNSAFE_SYNTAX: "miss.command.unsafeSyntax",
	MISS_COMMAND_NOT_ALLOWLISTED: "miss.command.notAllowlisted",
	MISS_COMMAND_ENV_ALTERING: "miss.command.envAltering",
	MISS_COMMAND_DIAGNOSTIC_ONLY: "miss.command.diagnosticOnly",

	// Misses — verification
	MISS_VERIFICATION_MISSING_FILE_HASHES: "miss.verification.missingFileHashes",
	MISS_VERIFICATION_INCOMPLETE_PROOF: "miss.verification.incompleteProof",

	// Misses — search
	MISS_SEARCH_NO_ENTRY: "miss.search.noEntry",
	MISS_SEARCH_CWD_CHANGED: "miss.search.cwdChanged",
	MISS_SEARCH_QUERY_CHANGED: "miss.search.queryChanged",
	MISS_SEARCH_GLOB_CHANGED: "miss.search.includeGlobChanged",

	// Stale
	STALE_FILE_HASH_CHANGED: "stale.fileHashChanged",
	STALE_GIT_HEAD_CHANGED: "stale.gitHeadChanged",
	STALE_LOCKFILE_CHANGED: "stale.lockfileChanged",
	STALE_WORKSPACE_GENERATION: "stale.workspaceGenerationChanged",
	STALE_TASK_GENERATION: "stale.taskGenerationChanged",
	STALE_APPROVAL_BOUNDARY: "stale.approvalBoundaryChanged",
	STALE_VALIDATION_FAILED: "stale.validationFailed",
	STALE_MARKED: "stale.marked",

	// Rejections
	REJECT_SECRET_DETECTED: "reject.secretDetected",
	REJECT_OVERSIZED: "reject.oversized",
	REJECT_SCRATCH_CACHE_DISABLED: "reject.scratchCacheDisabled",
	REJECT_MISSING_CLEANUP_HANDLER: "reject.missingCleanupHandler",
	REJECT_MISSING_OWNER_TASK: "reject.missingOwnerTask",
	REJECT_MISSING_TTL: "reject.missingTTL",
	REJECT_LATE_WRITE: "reject.lateWrite",
	REJECT_UNSCOPED_ENTRY: "reject.unscopedEntry",
	REJECT_CACHE_INTERNAL_ERROR: "reject.cacheInternalError",

	// Degraded
	DEGRADED_INTERNAL_FAILURE: "degraded.internalFailure",

	// Fallback
	FALLBACK_NORMAL_EXECUTION: "fallback.normalExecution",
	FALLBACK_CACHE_INTERNAL_ERROR: "fallback.cacheInternalError",

	// Trim / cleanup
	TRIM_TTL: "trim.ttl",
	TRIM_LRU: "trim.lru",
	TRIM_PRESSURE: "trim.pressure",
	TRIM_EMERGENCY: "trim.emergency",
	CLEANUP_SUCCESS: "cleanup.success",
	CLEANUP_FAILURE: "cleanup.failure",

	// Lifecycle
	LIFECYCLE_TASK_FLUSH: "lifecycle.taskFlush",
	LIFECYCLE_WORKSPACE_FLUSH: "lifecycle.workspaceFlush",
	LIFECYCLE_SHUTDOWN: "lifecycle.shutdown",
} as const

export type JoyRideReasonCode = (typeof JOYRIDE_REASON)[keyof typeof JOYRIDE_REASON]
