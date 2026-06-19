/**
 * [LAYER: CORE]
 * Frozen JoyRide modern API contract — export surface and import boundary rules.
 */

/** Symbols that must never appear on the public JoyRide export surface. */
export const JOYRIDE_FORBIDDEN_EXPORTS = [
	"lookupCommandResult",
	"storeCommandResult",
	"lookupGrepResult",
	"storeGrepResult",
	"JoyRideIntegration",
	"JoyRideCache",
	"createCommandResultCacheKey",
	"createGrepResultCacheKey",
	"createVerificationCacheKey",
	"createScratchArtifactCacheKey",
	"createJoyRideKey",
	"createJoyRideFingerprint",
	"hitDecision",
	"missDecision",
	"staleDecision",
	"rejectedDecision",
	"disabledDecision",
	"degradedDecision",
	"diagnosticOnlyDecision",
	"resetJoyRideForTest",
	"markJoyRideDegraded",
	"recordJoyRideCacheHit",
] as const

/** Approved runtime integration entrypoints (import from `@core/joyride` only). */
export const JOYRIDE_ALLOWED_INTEGRATION_IMPORTS = [
	"lookupSafeCommandResult",
	"storeReusableCommandResult",
	"storeCommandDiagnostic",
	"lookupVerificationProof",
	"storeVerificationProof",
	"storeFailedVerificationDiagnostic",
	"lookupSearchResult",
	"storeSearchResult",
	"isJoyRideHitDecision",
	"createJoyRideTaskScope",
	"registerTaskLifecycle",
	"bumpTaskGeneration",
	"flushTaskGeneration",
	"flushWorkspace",
	"shutdownJoyRide",
	"shutdownJoyRideCache",
	"getJoyRideCache",
	"getJoyRideConfig",
	"explainJoyRideConfig",
	"isJoyRideDisabled",
	"isDiagnosticsOnly",
	"isJoyRideDegraded",
	"getJoyRideDegradedReason",
	"isEnvAlteringCommand",
	"buildJoyRideWorkspaceSnapshot",
	"logJoyRideDiagnostics",
	"storeScratchArtifactWithCleanup",
] as const

/** Runtime files that must obey JoyRide import boundaries. */
export const JOYRIDE_RUNTIME_INTEGRATION_FILES = [
	"src/core/task/index.ts",
	"src/core/task/tools/handlers/SearchFilesToolHandler.ts",
	"src/core/task/tools/handlers/AttemptCompletionHandler.ts",
	"src/extension.ts",
] as const

/** Internal JoyRide modules runtime integrations must not import directly. */
export const JOYRIDE_FORBIDDEN_RUNTIME_IMPORTS = [
	"/JoyRideCache",
	"/JoyRideHotPath",
	"/JoyRideIntegration",
	"/joyride/keys",
	"/JoyRideDecisionLog",
	"/JoyRideDecisions",
	"/JoyRideAudit",
] as const

/** Forbidden direct cache method calls on hot-path integration sites. */
export const JOYRIDE_FORBIDDEN_CACHE_CALLS = [
	"getJoyRideCache().get(",
	"getJoyRideCache().set(",
	"getJoyRideCache().trySet(",
	"getJoyRideCache().flushTask(",
	"getJoyRideCache().invalidate",
	"joyRideCache",
	"services.joyRideCache",
] as const

/** Required fields on every JoyRide cache decision. */
export const JOYRIDE_DECISION_REQUIRED_FIELDS = [
	"type",
	"canReuse",
	"reasonCode",
	"reasonMessage",
	"fallbackBehavior",
	"diagnosticOnly",
	"degraded",
	"auditEventId",
] as const

/** Reason-code category prefixes — stable vocabulary contract. */
export const JOYRIDE_REASON_CATEGORY_PREFIXES = [
	"hit.",
	"miss.",
	"stale.",
	"reject.",
	"trim.",
	"cleanup.",
	"degraded.",
	"fallback.",
	"lifecycle.",
] as const

/** Vague reason fragments that must not appear in reason codes. */
export const JOYRIDE_FORBIDDEN_VAGUE_REASONS = [
	"unknown",
	"invalid",
	"failed",
	"unavailable",
	"skipped",
	"genericMiss",
	"legacyFallback",
	"error",
] as const

/** Frozen public export surface — changes require contract review. */
export const JOYRIDE_FROZEN_EXPORTS = [
	"getJoyRideCacheHitAuditCount",
	"getJoyRideCacheHitAuditTrail",
	"canCommandSkipExecution",
	"classifyCommand",
	"isCommandCacheEligible",
	"isEnvAlteringCommand",
	"isReadOnlyCacheableCommand",
	"isVerificationCommand",
	"explainJoyRideConfig",
	"getJoyRideConfig",
	"getJoyRideDegradedReason",
	"isCommandReuseEnabled",
	"isDiagnosticsOnly",
	"isJoyRideDegraded",
	"isJoyRideDisabled",
	"isScratchCacheEnabled",
	"isSearchCacheEnabled",
	"isVerificationCacheEnabled",
	"loadJoyRideConfigFromEnv",
	"resetJoyRideConfig",
	"setJoyRideConfig",
	"buildJoyRideWorkspaceSnapshot",
	"clearJoyRideDecisionLog",
	"explainJoyRideDecision",
	"getJoyRideDecisionLog",
	"getLastJoyRideDecision",
	"isJoyRideHitDecision",
	"buildJoyRideDiagnosticReport",
	"createJoyRideBugReportSnapshot",
	"dumpJoyRideDiagnostics",
	"formatJoyRideDiagnosticReport",
	"getJoyRideStats",
	"logJoyRideDiagnostics",
	"summarizeJoyRideHealth",
	"createJoyRideTaskScope",
	"lookupSafeCommandResult",
	"lookupSearchResult",
	"lookupVerificationProof",
	"storeCommandDiagnostic",
	"storeFailedVerificationDiagnostic",
	"storeReusableCommandResult",
	"storeSearchResult",
	"storeVerificationProof",
	"bumpTaskGeneration",
	"flushTaskGeneration",
	"flushWorkspace",
	"registerTaskLifecycle",
	"shutdownJoyRide",
	"withTaskCacheScope",
	"JOYRIDE_REASON",
	"createScratchArtifactEntry",
	"disposeScratchArtifact",
	"flushScratchForTask",
	"rejectUnsafeArtifact",
	"storeScratchArtifactWithCleanup",
	"buildVerificationFingerprint",
	"explainVerificationMiss",
	"lookupVerificationProofWithExplain",
	"validateVerificationProof",
	"getJoyRideCache",
	"shutdownJoyRideCache",
	"clearJoyRideDiagnostics",
] as const

/** Reason-code category documentation for bug reports. */
export const JOYRIDE_REASON_CATEGORIES = {
	hit: "Active reuse occurred — proof matched and skip was audited",
	miss: "No reuse — run work normally or store diagnostic if safe",
	stale: "Entry exists but is stale — rerun and retain bounded diagnostic",
	reject: "Admission refused — artifact or write rejected fail-closed",
	degraded: "JoyRide internal failure — active reuse suspended",
	fallback: "Internal fallback markers — not decision types",
	trim: "Budget pressure trimming",
	cleanup: "Scratch or lifecycle cleanup events",
	lifecycle: "Task/workspace flush or shutdown",
} as const
