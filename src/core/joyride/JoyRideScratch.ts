/**
 * [LAYER: CORE]
 * Scratch artifact admission helpers — safe path only.
 */

import { createHash } from "crypto"
import type { JoyRideCache } from "./JoyRideCache"
import { canJoyRideRetainScratch } from "./JoyRideConfig"
import { buildJoyRideWorkspaceSnapshot, type JoyRideTaskScope } from "./JoyRideContext"
import { recordJoyRideDecision } from "./JoyRideDecisionLog"
import { type JoyRideCacheDecision, rejectedDecision } from "./JoyRideDecisions"
import { JOYRIDE_REASON } from "./JoyRideReasonCodes"
import { createScratchArtifactCacheKey } from "./keys"
import type { JoyRideCleanupHandler, JoyRideDurability, JoyRideSetMetadata } from "./types"

export interface ScratchArtifactSpec {
	artifactKind: string
	ownerTaskId: string
	ttlMs: number
	estimatedBytes: number
	cleanupHandler: JoyRideCleanupHandler
	durability?: JoyRideDurability
	diagnosticOnly?: boolean
}

export interface ScratchArtifactEntry {
	kind: string
	value: unknown
	ownerTaskId: string
	createdAt: number
}

export function createScratchArtifactEntry(spec: ScratchArtifactSpec, value: unknown): ScratchArtifactEntry {
	return {
		kind: spec.artifactKind,
		value,
		ownerTaskId: spec.ownerTaskId,
		createdAt: Date.now(),
	}
}

export function explainScratchRejection(reasonCode: string, reasonMessage: string): JoyRideCacheDecision {
	return rejectedDecision(reasonCode as (typeof JOYRIDE_REASON)[keyof typeof JOYRIDE_REASON], reasonMessage)
}

export function rejectUnsafeArtifact(reasonCode: string, reasonMessage: string): JoyRideCacheDecision {
	const decision = explainScratchRejection(reasonCode, reasonMessage)
	recordJoyRideDecision(decision)
	return decision
}

export async function storeScratchArtifactWithCleanup(
	cache: JoyRideCache,
	spec: ScratchArtifactSpec,
	value: unknown,
	scope: JoyRideTaskScope,
): Promise<JoyRideCacheDecision> {
	if (!canJoyRideRetainScratch()) {
		return rejectUnsafeArtifact(JOYRIDE_REASON.REJECT_SCRATCH_CACHE_DISABLED, "Scratch cache disabled via config")
	}
	if (!spec.ownerTaskId) {
		return rejectUnsafeArtifact(JOYRIDE_REASON.REJECT_MISSING_OWNER_TASK, "Scratch artifact requires ownerTaskId")
	}
	if (!spec.ttlMs || spec.ttlMs <= 0) {
		return rejectUnsafeArtifact(JOYRIDE_REASON.REJECT_MISSING_TTL, "Scratch artifact requires positive TTL")
	}
	if (!spec.cleanupHandler) {
		return rejectUnsafeArtifact(JOYRIDE_REASON.REJECT_MISSING_CLEANUP_HANDLER, "Scratch artifact requires cleanup handler")
	}
	if (!spec.estimatedBytes || spec.estimatedBytes <= 0) {
		return rejectUnsafeArtifact(JOYRIDE_REASON.REJECT_OVERSIZED, "Scratch artifact requires estimated size")
	}

	try {
		const snapshot = await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode)
		const contentHash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)
		const key = createScratchArtifactCacheKey({
			taskId: spec.ownerTaskId,
			artifactKind: spec.artifactKind,
			contentHash,
			generation: scope.generation,
			cleanupPolicy: "task-scoped",
		})
		const entry = createScratchArtifactEntry(spec, value)
		const metadata: JoyRideSetMetadata = {
			cacheKind: "scratchArtifact",
			scope: { type: "scratch", id: spec.ownerTaskId },
			ownerTaskId: spec.ownerTaskId,
			ttlMs: spec.ttlMs,
			fingerprint: key.fingerprint,
			workspaceFingerprint: snapshot.workspaceFingerprint,
			approvalBoundaryId: scope.approvalBoundaryId,
			durability: spec.durability ?? "memoryOnly",
			invalidationReason: ["ttl_expired", "task_completed", "task_cancelled", "manual_flush"],
			admissionReason: "scratch artifact with cleanup",
			safetyClassification: "taskLocal",
			generation: scope.generation,
			environmentFingerprint: snapshot.environmentFingerprint,
			gitHead: snapshot.gitHead,
			dependencyFingerprint: snapshot.dependencyFingerprint,
			lockfileFingerprint: snapshot.lockfileFingerprint,
			runtimeVersion: process.version,
			cleanupHandler: spec.cleanupHandler,
			estimatedBytes: spec.estimatedBytes,
		}
		const result = cache.trySet(key.key, entry, metadata)
		if (!result.accepted) {
			return rejectUnsafeArtifact(JOYRIDE_REASON.REJECT_UNSCOPED_ENTRY, result.reason ?? "scratch admission rejected")
		}
		const decision: JoyRideCacheDecision = {
			type: "hit",
			canReuse: false,
			reasonCode: JOYRIDE_REASON.CLEANUP_SUCCESS,
			reasonMessage: "scratch stored",
			diagnosticOnly: spec.diagnosticOnly ?? false,
			fallbackBehavior: "executeNormally",
			degraded: false,
			auditEventId: `joyride-scratch-${Date.now()}`,
			keySummary: key.key.slice(0, 48),
		}
		recordJoyRideDecision(decision)
		return decision
	} catch (error) {
		return rejectUnsafeArtifact(
			JOYRIDE_REASON.REJECT_CACHE_INTERNAL_ERROR,
			`Scratch admission failed: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

export function flushScratchForTask(cache: JoyRideCache, taskId: string): number {
	return cache.flushTask(taskId, "task_completed")
}

export function disposeScratchArtifact(cache: JoyRideCache, key: string): boolean {
	return cache.dispose(key)
}
