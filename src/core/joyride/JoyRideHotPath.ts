/**
 * [LAYER: CORE]
 * Intention-revealing JoyRide hot-path APIs with typed cache decisions.
 */

import type { DietCodeToolResponseContent } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { recordJoyRideCacheHit } from "./JoyRideAudit"
import type { JoyRideCache } from "./JoyRideCache"
import { classifyCommand, isEnvAlteringCommand, isVerificationCommand } from "./JoyRideCommandClassifier"
import {
	canJoyRideReuseCommands,
	canJoyRideReuseSearch,
	canJoyRideReuseVerification,
	canJoyRideSkipWork,
	canJoyRideStore,
	explainJoyRideConfig,
	isDiagnosticsOnly,
	isJoyRideDegraded,
	isJoyRideDisabled,
	markJoyRideDegraded,
} from "./JoyRideConfig"
import {
	buildApprovalBoundaryId,
	buildJoyRideWorkspaceSnapshot,
	type JoyRideTaskScope,
	type JoyRideWorkspaceSnapshot,
} from "./JoyRideContext"
import { recordJoyRideDecision } from "./JoyRideDecisionLog"
import {
	degradedDecision,
	diagnosticOnlyDecision,
	disabledDecision,
	hitDecision,
	type JoyRideCacheDecision,
	type JoyRideCommandLookupDecision,
	type JoyRideSearchLookupDecision,
	missDecision,
} from "./JoyRideDecisions"
import type { JoyRideCommandCacheEntry, JoyRideGrepCacheEntry, JoyRideSearchLookupOptions } from "./JoyRideHotPathTypes"
import { JOYRIDE_REASON } from "./JoyRideReasonCodes"
import {
	createCommandResultCacheKey,
	createGrepResultCacheKey,
	createJoyRideFingerprint,
	createVerificationCacheKey,
} from "./keys"
import { summarizeJoyRideCommandOutput } from "./summaries"
import type { JoyRideSetMetadata, JoyRideValidationFingerprint } from "./types"

const SEARCH_IMPLEMENTATION_VERSION = "ripgrep-v1"

function recordAndReturn<T>(decision: JoyRideCacheDecision<T>): JoyRideCacheDecision<T> {
	recordJoyRideDecision(decision)
	return decision
}

function scopeContext(scope: JoyRideTaskScope, changedFileGeneration?: number) {
	return {
		ownerTaskId: scope.taskId,
		approvalBoundaryId: scope.approvalBoundaryId,
		scope: scope.taskId,
		workspaceGeneration: changedFileGeneration ?? scope.generation,
		configExplanation: explainJoyRideConfig(),
		degraded: isJoyRideDegraded(),
	}
}

function configDisabledDecision<T>(
	cacheKind?: JoyRideSetMetadata["cacheKind"],
	scope?: JoyRideTaskScope,
): JoyRideCacheDecision<T> {
	const ctx = scope ? scopeContext(scope) : { configExplanation: explainJoyRideConfig(), degraded: isJoyRideDegraded() }
	if (isJoyRideDisabled()) {
		return recordAndReturn(
			disabledDecision(JOYRIDE_REASON.MISS_CONFIG_DISABLED, "JoyRide disabled via config", { cacheKind, ...ctx }),
		)
	}
	if (isDiagnosticsOnly()) {
		return recordAndReturn(
			disabledDecision(JOYRIDE_REASON.MISS_CONFIG_DIAGNOSTICS_ONLY, "JoyRide diagnostics-only mode", { cacheKind, ...ctx }),
		)
	}
	if (isJoyRideDegraded()) {
		return recordAndReturn(
			degradedDecision(JOYRIDE_REASON.MISS_CACHE_DEGRADED, "JoyRide degraded — active reuse suspended", {
				cacheKind,
				...ctx,
			}),
		)
	}
	return recordAndReturn(missDecision(JOYRIDE_REASON.MISS_NO_ENTRY, "JoyRide skip work unavailable", { cacheKind, ...ctx }))
}

function handleInternalError<T>(
	operation: string,
	error: unknown,
	cacheKind?: JoyRideSetMetadata["cacheKind"],
	scope?: JoyRideTaskScope,
): JoyRideCacheDecision<T> {
	Logger.warn(`[JoyRide] ${operation} failed:`, error)
	markJoyRideDegraded(`${operation}: ${error instanceof Error ? error.message : String(error)}`)
	return recordAndReturn(
		degradedDecision(
			JOYRIDE_REASON.DEGRADED_INTERNAL_FAILURE,
			`Internal error — falling back to normal execution (${operation})`,
			{
				cacheKind,
				operationType: operation,
				reuseBlockReason: JOYRIDE_REASON.FALLBACK_NORMAL_EXECUTION,
				...(scope ? scopeContext(scope) : {}),
			},
		),
	)
}

function baseSetMetadata(
	scope: JoyRideTaskScope,
	snapshot: JoyRideWorkspaceSnapshot,
	cacheKind: JoyRideSetMetadata["cacheKind"],
	ttlMs: number,
	admissionReason: string,
	extra?: Partial<JoyRideSetMetadata>,
): JoyRideSetMetadata {
	return {
		cacheKind,
		scope: { type: "task", id: scope.taskId },
		ownerTaskId: scope.taskId,
		ttlMs,
		fingerprint: "",
		workspaceFingerprint: snapshot.workspaceFingerprint,
		approvalBoundaryId: scope.approvalBoundaryId,
		durability: "memoryOnly",
		invalidationReason: [
			"ttl_expired",
			"task_completed",
			"task_cancelled",
			"workspace_drift",
			"approval_boundary_changed",
			"command_environment_changed",
			"file_hash_changed",
			"git_head_changed",
			"dependency_fingerprint_changed",
			"lockfile_fingerprint_changed",
		],
		admissionReason,
		safetyClassification: "taskLocal",
		generation: scope.generation,
		environmentFingerprint: snapshot.environmentFingerprint,
		gitHead: snapshot.gitHead,
		dependencyFingerprint: snapshot.dependencyFingerprint,
		lockfileFingerprint: snapshot.lockfileFingerprint,
		runtimeVersion: process.version,
		...extra,
	}
}

function buildCommandValidation(
	snapshot: JoyRideWorkspaceSnapshot,
	scope: JoyRideTaskScope,
	fingerprint: string,
): JoyRideValidationFingerprint {
	return {
		fingerprint,
		workspaceFingerprint: snapshot.workspaceFingerprint,
		approvalBoundaryId: scope.approvalBoundaryId,
		generation: scope.generation,
		environmentFingerprint: snapshot.environmentFingerprint,
		gitHead: snapshot.gitHead,
		dependencyFingerprint: snapshot.dependencyFingerprint,
		lockfileFingerprint: snapshot.lockfileFingerprint,
		runtimeVersion: process.version,
	}
}

function buildVerificationValidation(
	snapshot: JoyRideWorkspaceSnapshot,
	scope: JoyRideTaskScope,
	fingerprint: string,
	relevantFileHashes: Record<string, string>,
): JoyRideValidationFingerprint {
	return {
		...buildCommandValidation(snapshot, scope, fingerprint),
		relevantFileHashes,
		toolVersion: "lumi-verification-v1",
	}
}

function hasCompleteVerificationProof(relevantFileHashes: Record<string, string>): boolean {
	return Object.keys(relevantFileHashes).length > 0
}

function extractExitCode(outputText: string): number | undefined {
	const match = outputText.match(/(?:exit code|exit status|Exit code)[:\s]+(\d+)/i)
	if (match) {
		return Number.parseInt(match[1], 10)
	}
	return undefined
}

function toolResponseToText(toolResponse: DietCodeToolResponseContent): string {
	return typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse)
}

function recordHit(
	cache: JoyRideCache,
	key: string,
	cacheKind: JoyRideSetMetadata["cacheKind"],
	operationType: string,
	scope: JoyRideTaskScope,
	reuseReason: string,
	hitSource: "command" | "verification" | "grep",
	fingerprintSummary: string,
): void {
	const explanation = cache.explain(key)
	recordJoyRideCacheHit({
		key,
		cacheKind,
		operationType,
		ownerTaskId: scope.taskId,
		validationFingerprintSummary: fingerprintSummary,
		reuseReason,
		entryAgeMs: explanation.ageMs ?? 0,
		hitSource,
	})
}

export async function lookupSafeCommandResult(
	cache: JoyRideCache,
	command: string,
	scope: JoyRideTaskScope,
	changedFileGeneration = 0,
	relevantFileHashes: Record<string, string> = {},
): Promise<JoyRideCommandLookupDecision> {
	if (!canJoyRideSkipWork()) {
		return configDisabledDecision("hotExecution", scope)
	}

	const classification = classifyCommand(command)

	try {
		const snapshot = await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode, changedFileGeneration)

		if (isVerificationCommand(command)) {
			return lookupVerificationProof(cache, command, scope, snapshot, relevantFileHashes)
		}

		if (!canJoyRideReuseCommands()) {
			return recordAndReturn(
				missDecision(JOYRIDE_REASON.MISS_CONFIG_COMMAND_REUSE_DISABLED, "Command reuse disabled via config", {
					cacheKind: "hotExecution",
					operationType: command,
					reuseBlockReason: explainJoyRideConfig(),
					...scopeContext(scope, changedFileGeneration),
				}),
			)
		}

		if (!classification.canSkipExecution) {
			return recordAndReturn(
				diagnosticOnlyDecision(classification.reasonCode, classification.reason, {
					cacheKind: "hotExecution",
					operationType: command,
					reuseBlockReason: classification.reasonCode,
					...scopeContext(scope, changedFileGeneration),
				}),
			)
		}

		const key = createCommandResultCacheKey({
			command,
			cwd: scope.cwd,
			environmentFingerprint: snapshot.environmentFingerprint,
			dependencyFingerprint: snapshot.dependencyFingerprint,
			gitHead: snapshot.gitHead,
			runtimeVersion: process.version,
		})
		const validation = buildCommandValidation(snapshot, scope, key.fingerprint)
		const cached = cache.get<JoyRideCommandCacheEntry>(key.key, validation)

		if (!cached) {
			return recordAndReturn(
				missDecision(JOYRIDE_REASON.MISS_NO_ENTRY, "No cached command result", {
					cacheKind: "hotExecution",
					keySummary: key.key.slice(0, 48),
					proofSummary: createJoyRideFingerprint(validation).slice(0, 16),
				}),
			)
		}

		if (cached.userRejected || cached.diagnosticOnly) {
			return recordAndReturn(
				diagnosticOnlyDecision(JOYRIDE_REASON.MISS_COMMAND_DIAGNOSTIC_ONLY, "Cached entry is diagnostic-only", {
					cacheKind: "hotExecution",
					keySummary: key.key.slice(0, 48),
					reuseBlockReason: cached.classificationReason ?? "diagnostic_only",
				}),
			)
		}

		const explanation = cache.explain(key.key)
		recordHit(
			cache,
			key.key,
			"hotExecution",
			command,
			scope,
			classification.reason,
			"command",
			createJoyRideFingerprint(validation).slice(0, 16),
		)
		const value: [boolean, DietCodeToolResponseContent] = [false, cached.outputSummary.text]
		return recordAndReturn(
			hitDecision(JOYRIDE_REASON.HIT_COMMAND_SAFE_ALLOWLISTED, classification.reason, value, {
				cacheKind: "hotExecution",
				keySummary: key.key.slice(0, 48),
				proofSummary: createJoyRideFingerprint(validation).slice(0, 16),
				entryAgeMs: explanation.ageMs,
				ttlRemainingMs: explanation.expiresAt ? explanation.expiresAt - Date.now() : undefined,
			}),
		)
	} catch (error) {
		return handleInternalError("lookupSafeCommandResult", error, "hotExecution", scope)
	}
}

export async function lookupVerificationProof(
	cache: JoyRideCache,
	command: string,
	scope: JoyRideTaskScope,
	snapshot?: JoyRideWorkspaceSnapshot,
	relevantFileHashes: Record<string, string> = {},
): Promise<JoyRideCommandLookupDecision> {
	if (!canJoyRideSkipWork()) {
		return configDisabledDecision("verification", scope)
	}
	if (!canJoyRideReuseVerification()) {
		return recordAndReturn(
			missDecision(JOYRIDE_REASON.MISS_CONFIG_VERIFICATION_CACHE_DISABLED, "Verification cache disabled via config", {
				cacheKind: "verification",
			}),
		)
	}
	if (!hasCompleteVerificationProof(relevantFileHashes)) {
		return recordAndReturn(
			missDecision(JOYRIDE_REASON.MISS_VERIFICATION_MISSING_FILE_HASHES, "Verification requires complete file-hash proof", {
				cacheKind: "verification",
				reuseBlockReason: JOYRIDE_REASON.MISS_VERIFICATION_INCOMPLETE_PROOF,
			}),
		)
	}

	try {
		const ws = snapshot ?? (await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode))
		const verifyKey = createVerificationCacheKey({
			command,
			cwd: scope.cwd,
			dependencyFingerprint: ws.dependencyFingerprint,
			lockfileFingerprint: ws.lockfileFingerprint,
			relevantFileHashes,
			environmentFingerprint: ws.environmentFingerprint,
			approvalBoundaryId: scope.approvalBoundaryId,
			gitHead: ws.gitHead,
			runtimeVersion: process.version,
			toolVersion: "lumi-verification-v1",
		})
		const validation = buildVerificationValidation(ws, scope, verifyKey.fingerprint, relevantFileHashes)
		const cached = cache.get<JoyRideCommandCacheEntry>(verifyKey.key, validation)

		if (!cached) {
			return recordAndReturn(
				missDecision(JOYRIDE_REASON.MISS_NO_ENTRY, "No cached verification proof", {
					cacheKind: "verification",
					keySummary: verifyKey.key.slice(0, 48),
					proofSummary: createJoyRideFingerprint(validation).slice(0, 16),
				}),
			)
		}

		if (cached.userRejected || cached.diagnosticOnly) {
			return recordAndReturn(
				diagnosticOnlyDecision(JOYRIDE_REASON.MISS_COMMAND_DIAGNOSTIC_ONLY, "Verification entry is diagnostic-only", {
					cacheKind: "verification",
					keySummary: verifyKey.key.slice(0, 48),
					reuseBlockReason: cached.classificationReason ?? "failed_or_rejected",
				}),
			)
		}

		const explanation = cache.explain(verifyKey.key)
		recordHit(
			cache,
			verifyKey.key,
			"verification",
			command,
			scope,
			"verification_proof_complete",
			"verification",
			createJoyRideFingerprint(validation).slice(0, 16),
		)
		const value: [boolean, DietCodeToolResponseContent] = [false, cached.outputSummary.text]
		return recordAndReturn(
			hitDecision(JOYRIDE_REASON.HIT_VERIFICATION_COMPLETE_PROOF, "Verification proof matched", value, {
				cacheKind: "verification",
				keySummary: verifyKey.key.slice(0, 48),
				proofSummary: createJoyRideFingerprint(validation).slice(0, 16),
				entryAgeMs: explanation.ageMs,
			}),
		)
	} catch (error) {
		return handleInternalError("lookupVerificationProof", error, "verification", scope)
	}
}

export async function lookupSearchResult(
	cache: JoyRideCache,
	query: string,
	options: JoyRideSearchLookupOptions,
	scope: JoyRideTaskScope,
	changedFileGeneration = 0,
): Promise<JoyRideSearchLookupDecision> {
	if (!canJoyRideSkipWork()) {
		return configDisabledDecision("workspaceIndex", scope)
	}
	if (!canJoyRideReuseSearch()) {
		return recordAndReturn(
			missDecision(JOYRIDE_REASON.MISS_CONFIG_SEARCH_CACHE_DISABLED, "Search cache disabled via config", {
				cacheKind: "workspaceIndex",
			}),
		)
	}

	try {
		const snapshot = await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode, changedFileGeneration)
		const key = createGrepResultCacheKey({
			query,
			cwd: options.cwd,
			includeGlobs: options.includeGlobs,
			excludeGlobs: options.excludeGlobs,
			workspaceFingerprint: snapshot.workspaceFingerprint,
			changedFileGeneration,
			caseSensitive: options.caseSensitive ?? true,
			searchImplementationVersion: SEARCH_IMPLEMENTATION_VERSION,
		})
		const validation = buildCommandValidation(snapshot, scope, key.fingerprint)
		const cached = cache.get<JoyRideGrepCacheEntry>(key.key, validation)

		if (!cached) {
			return recordAndReturn(
				missDecision(JOYRIDE_REASON.MISS_SEARCH_NO_ENTRY, "No cached search result", {
					cacheKind: "workspaceIndex",
					keySummary: key.key.slice(0, 48),
					proofSummary: createJoyRideFingerprint(validation).slice(0, 16),
				}),
			)
		}

		const explanation = cache.explain(key.key)
		recordHit(
			cache,
			key.key,
			"workspaceIndex",
			query,
			scope,
			"grep_workspace_fingerprint_match",
			"grep",
			createJoyRideFingerprint(validation).slice(0, 16),
		)
		return recordAndReturn(
			hitDecision(JOYRIDE_REASON.HIT_SEARCH_WORKSPACE_FINGERPRINT, "Search workspace fingerprint matched", cached.results, {
				cacheKind: "workspaceIndex",
				keySummary: key.key.slice(0, 48),
				proofSummary: createJoyRideFingerprint(validation).slice(0, 16),
				entryAgeMs: explanation.ageMs,
			}),
		)
	} catch (error) {
		return handleInternalError("lookupSearchResult", error, "workspaceIndex", scope)
	}
}

export async function storeReusableCommandResult(
	cache: JoyRideCache,
	command: string,
	result: [boolean, DietCodeToolResponseContent],
	scope: JoyRideTaskScope,
	changedFileGeneration = 0,
): Promise<void> {
	if (!canJoyRideStore()) {
		return
	}

	const classification = classifyCommand(command)
	if (!classification.canStoreDiagnostic) {
		return
	}

	try {
		const [userRejected, toolResponse] = result
		const outputText = toolResponseToText(toolResponse)
		const summary = summarizeJoyRideCommandOutput(outputText)
		const snapshot = await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode, changedFileGeneration)
		const exitCode = extractExitCode(outputText)
		const failed = exitCode !== undefined && exitCode !== 0
		const diagnosticOnly = userRejected || failed || isEnvAlteringCommand(command) || !classification.canSkipExecution

		const value: JoyRideCommandCacheEntry = {
			command,
			cwd: scope.cwd,
			userRejected,
			exitCode,
			outputSummary: summary,
			capturedAt: Date.now(),
			diagnosticOnly,
			classificationReason: classification.reason,
		}

		if (isVerificationCommand(command)) {
			await storeVerificationProof(cache, command, value, scope, snapshot, diagnosticOnly)
			return
		}

		const key = createCommandResultCacheKey({
			command,
			cwd: scope.cwd,
			environmentFingerprint: snapshot.environmentFingerprint,
			dependencyFingerprint: snapshot.dependencyFingerprint,
			gitHead: snapshot.gitHead,
			runtimeVersion: process.version,
		})
		const metadata = baseSetMetadata(scope, snapshot, "hotExecution", 5 * 60 * 1000, "recent command output summary", {
			fingerprint: key.fingerprint,
		})
		cache.trySet(key.key, value, metadata)
	} catch (error) {
		Logger.warn("[JoyRide] Command result cache admission skipped:", error)
	}
}

export async function storeCommandDiagnostic(
	cache: JoyRideCache,
	command: string,
	result: [boolean, DietCodeToolResponseContent],
	scope: JoyRideTaskScope,
	changedFileGeneration = 0,
): Promise<void> {
	await storeReusableCommandResult(cache, command, result, scope, changedFileGeneration)
}

export async function storeVerificationProof(
	cache: JoyRideCache,
	command: string,
	value: JoyRideCommandCacheEntry,
	scope: JoyRideTaskScope,
	snapshot?: JoyRideWorkspaceSnapshot,
	diagnosticOnly = value.diagnosticOnly,
	relevantFileHashes: Record<string, string> = {},
): Promise<void> {
	if (!canJoyRideStore()) {
		return
	}

	try {
		const ws = snapshot ?? (await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode))
		const verifyKey = createVerificationCacheKey({
			command,
			cwd: scope.cwd,
			dependencyFingerprint: ws.dependencyFingerprint,
			lockfileFingerprint: ws.lockfileFingerprint,
			relevantFileHashes,
			environmentFingerprint: ws.environmentFingerprint,
			approvalBoundaryId: scope.approvalBoundaryId,
			gitHead: ws.gitHead,
			runtimeVersion: process.version,
			toolVersion: "lumi-verification-v1",
		})
		const metadata = baseSetMetadata(scope, ws, "verification", 10 * 60 * 1000, "verification command output", {
			fingerprint: verifyKey.fingerprint,
			scope: { type: "verification", id: scope.taskId },
			relevantFileHashes,
			toolVersion: "lumi-verification-v1",
		})
		cache.trySet(verifyKey.key, { ...value, diagnosticOnly }, metadata)
	} catch (error) {
		Logger.warn("[JoyRide] Verification proof admission skipped:", error)
	}
}

export async function storeFailedVerificationDiagnostic(
	cache: JoyRideCache,
	command: string,
	result: [boolean, DietCodeToolResponseContent],
	scope: JoyRideTaskScope,
	changedFileGeneration = 0,
): Promise<void> {
	await storeReusableCommandResult(cache, command, result, scope, changedFileGeneration)
}

export async function storeSearchResult(
	cache: JoyRideCache,
	query: string,
	options: JoyRideSearchLookupOptions,
	results: string,
	resultCount: number,
	scope: JoyRideTaskScope,
	changedFileGeneration = 0,
): Promise<void> {
	if (!canJoyRideStore()) {
		return
	}

	try {
		const snapshot = await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode, changedFileGeneration)
		const key = createGrepResultCacheKey({
			query,
			cwd: options.cwd,
			includeGlobs: options.includeGlobs,
			excludeGlobs: options.excludeGlobs,
			workspaceFingerprint: snapshot.workspaceFingerprint,
			changedFileGeneration,
			caseSensitive: options.caseSensitive ?? true,
			searchImplementationVersion: SEARCH_IMPLEMENTATION_VERSION,
		})
		const value: JoyRideGrepCacheEntry = { results, resultCount, capturedAt: Date.now() }
		const metadata = baseSetMetadata(scope, snapshot, "workspaceIndex", 3 * 60 * 1000, "grep/search result reuse", {
			fingerprint: key.fingerprint,
			scope: { type: "workspace", id: scope.cwd },
		})
		cache.trySet(key.key, value, { ...metadata, estimatedBytes: Math.min(results.length * 2 + 256, 512 * 1024) })
	} catch (error) {
		Logger.warn("[JoyRide] Search cache admission skipped:", error)
	}
}

export function createJoyRideTaskScope(
	taskId: string,
	cwd: string,
	terminalMode: string,
	apiRequestCount: number,
): JoyRideTaskScope {
	return {
		taskId,
		cwd,
		terminalMode,
		generation: apiRequestCount,
		approvalBoundaryId: buildApprovalBoundaryId(taskId, apiRequestCount),
	}
}
