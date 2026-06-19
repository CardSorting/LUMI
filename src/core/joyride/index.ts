/**
 * [LAYER: CORE]
 * Modern JoyRide execution cache API — typed decisions only (frozen contract).
 *
 * @license MIT
 * Copyright (c) CardSorting
 * @see JoyRideContract.ts for export/import boundary rules.
 * @see CONTRIBUTING.md for contributor workflow.
 * Legacy APIs were removed. Use typed decision APIs only.
 */

export type { JoyRideCacheHitAudit } from "./JoyRideAudit"
export { getJoyRideCacheHitAuditCount, getJoyRideCacheHitAuditTrail } from "./JoyRideAudit"
export type { JoyRideCommandClassification, JoyRideCommandTier } from "./JoyRideCommandClassifier"
export {
	canCommandSkipExecution,
	classifyCommand,
	isCommandCacheEligible,
	isEnvAlteringCommand,
	isReadOnlyCacheableCommand,
	isVerificationCommand,
} from "./JoyRideCommandClassifier"
export type { JoyRideOperationalConfig, JoyRideOperationalMode } from "./JoyRideConfig"
export {
	explainJoyRideConfig,
	getJoyRideConfig,
	getJoyRideDegradedReason,
	isCommandReuseEnabled,
	isDiagnosticsOnly,
	isJoyRideDegraded,
	isJoyRideDisabled,
	isScratchCacheEnabled,
	isSearchCacheEnabled,
	isVerificationCacheEnabled,
	loadJoyRideConfigFromEnv,
	resetJoyRideConfig,
	setJoyRideConfig,
} from "./JoyRideConfig"
export { buildJoyRideWorkspaceSnapshot } from "./JoyRideContext"
export {
	clearJoyRideDecisionLog,
	explainJoyRideDecision,
	getJoyRideDecisionLog,
	getLastJoyRideDecision,
} from "./JoyRideDecisionLog"
export type {
	JoyRideCacheDecision,
	JoyRideCommandLookupDecision,
	JoyRideDecisionContext,
	JoyRideDecisionType,
	JoyRideDegradedDecision,
	JoyRideDiagnosticOnlyDecision,
	JoyRideDisabledDecision,
	JoyRideFallbackBehavior,
	JoyRideHitDecision,
	JoyRideMissDecision,
	JoyRideRejectedDecision,
	JoyRideSearchLookupDecision,
	JoyRideStaleDecision,
} from "./JoyRideDecisions"
export { isJoyRideHitDecision } from "./JoyRideDecisions"
export type { JoyRideDiagnosticReport } from "./JoyRideDiagnostics"
export {
	buildJoyRideDiagnosticReport,
	createJoyRideBugReportSnapshot,
	dumpJoyRideDiagnostics,
	formatJoyRideDiagnosticReport,
	getJoyRideStats,
	logJoyRideDiagnostics,
	summarizeJoyRideHealth,
} from "./JoyRideDiagnostics"
export {
	createJoyRideTaskScope,
	lookupSafeCommandResult,
	lookupSearchResult,
	lookupVerificationProof,
	storeCommandDiagnostic,
	storeFailedVerificationDiagnostic,
	storeReusableCommandResult,
	storeSearchResult,
	storeVerificationProof,
} from "./JoyRideHotPath"
export type {
	JoyRideCommandCacheEntry,
	JoyRideGrepCacheEntry,
	JoyRideSearchLookupOptions,
} from "./JoyRideHotPathTypes"
export {
	bumpTaskGeneration,
	flushTaskGeneration,
	flushWorkspace,
	registerTaskLifecycle,
	shutdownJoyRide,
	withTaskCacheScope,
} from "./JoyRideLifecycle"
export type { JoyRideReasonCode } from "./JoyRideReasonCodes"
export { JOYRIDE_REASON } from "./JoyRideReasonCodes"
export type { ScratchArtifactEntry, ScratchArtifactSpec } from "./JoyRideScratch"
export {
	createScratchArtifactEntry,
	disposeScratchArtifact,
	flushScratchForTask,
	rejectUnsafeArtifact,
	storeScratchArtifactWithCleanup,
} from "./JoyRideScratch"
export type { VerificationProofInput } from "./JoyRideVerification"
export {
	buildVerificationFingerprint,
	explainVerificationMiss,
	lookupVerificationProofWithExplain,
	validateVerificationProof,
} from "./JoyRideVerification"

import { JoyRideCache } from "./JoyRideCache"
import { shutdownJoyRide } from "./JoyRideLifecycle"

const joyRideCache = new JoyRideCache()

/** Singleton JoyRide cache instance — pass to modern lookup/store helpers only. */
export function getJoyRideCache(): JoyRideCache {
	return joyRideCache
}

/** Extension deactivate shutdown — delegates to lifecycle helper. */
export function shutdownJoyRideCache(): number {
	return shutdownJoyRide(joyRideCache, "workspace_closed")
}

export { clearJoyRideDecisionLog as clearJoyRideDiagnostics } from "./JoyRideDecisionLog"
