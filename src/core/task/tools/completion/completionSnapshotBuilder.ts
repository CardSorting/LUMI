/**
 * Adapter — normalizes TaskConfig/TaskState into an immutable
 * CompletionLifecycleSnapshot for the decision engine.
 *
 * This is the ONLY place that reads mutable task state for completion decisions.
 * Handlers call this adapter, the engine decides, handlers execute.
 */

import type { AuditGateDecision } from "@shared/audit/auditGateReport"
import { getCompletionGraphRevision, getLatestCheckpointHashFromMessages, hashCompletionResult } from "../attemptCompletionUtils"
import type { TaskConfig } from "../types/TaskConfig"
import type { CompletionLifecycleSnapshot, LifecycleRegistry } from "./CompletionLifecycleTypes"
import { DEFAULT_GATE_REGISTRY } from "./gateRegistry"

/**
 * Build an immutable snapshot from TaskConfig for the decision engine.
 *
 * Optionally accepts a pre-computed audit cache key and result fingerprint
 * (avoids recomputation when the handler already computed them).
 */
export function buildCompletionSnapshot(
	config: TaskConfig,
	options?: {
		result?: string
		taskDescription?: string
		auditCacheKey?: string
		auditGateDecision?: AuditGateDecision
		/** Override checkpoint hash (used when caller already computed it). */
		checkpointHash?: string
	},
): CompletionLifecycleSnapshot {
	const taskState = config.taskState
	const checkpointHash = options?.checkpointHash ?? getLatestCheckpointHashFromMessages(config)
	const graphRevision = getCompletionGraphRevision(config)
	const registry: LifecycleRegistry = { gates: DEFAULT_GATE_REGISTRY }

	// Compute audit cache key if not provided
	const taskDescription = options?.taskDescription ?? ""
	const auditCacheKey =
		options?.auditCacheKey ??
		(options?.result ? hashCompletionAuditInputLocal(options.result, taskDescription, checkpointHash) : undefined)

	// Compute result fingerprint if result provided
	const resultFingerprint = options?.result ? hashCompletionResult(options.result) : undefined

	// Parse finalization evidence status
	const finalizationEvidenceStatus = parseFinalizationEvidenceStatus(taskState.finalizationEvidenceJson)

	// Parse cached lifecycle state
	const cachedLifecycleState = parseCachedLifecycleState(taskState.lastGateLifecycleDecision)

	return {
		taskId: config.taskId,
		sessionId: taskState.completionGateSessionId,
		checkpointHash,
		graphRevision,
		registry,
		engineeringVerifiedAt: taskState.engineeringVerifiedAt,
		finalizationPhase: taskState.finalizationPhase,
		finalizationEvidenceStatus,
		resultFingerprint,
		lastCompletionAttemptAt: taskState.lastCompletionAttemptAt,
		lastCompletionAttemptGraphRevision: taskState.lastCompletionAttemptGraphRevision,
		blockCount: taskState.completionGateBlockCount ?? 0,
		lastGateBlockCheckpointHash: taskState.lastGateBlockCheckpointHash,
		lastBlockedResultFingerprint: taskState.lastBlockedCompletionResultFingerprint,
		auditMetadata: taskState.lastCompletionAudit,
		auditCacheKey,
		lastAuditCacheKey: taskState.lastCompletionAuditCacheKey,
		auditCachedAt: taskState.lastCompletionAuditCachedAt,
		auditGraphRevision: taskState.lastCompletionAuditGraphRevision,
		auditGateEnabled: config.auditCompletionGateEnabled ?? false,
		auditGateDecision: options?.auditGateDecision,
		cachedLifecycleState,
		cachedLifecycleDecisionEvaluatedAt: undefined,
		lastProbeCheckpointHash: taskState.lastProbeCheckpointHash,
		now: Date.now(),
	}
}

// Local copy to avoid circular import with completionGatePipeline
function hashCompletionAuditInputLocal(result: string, taskDescription: string, checkpointHash?: string): string {
	// Delegates to the pipeline's hashCompletionAuditInput via dynamic import is overkill;
	// the hash is simple enough to inline.  Must match hashCompletionAuditInput in completionGatePipeline.ts
	const { createHash } = require("node:crypto") as typeof import("node:crypto")
	return createHash("sha256")
		.update(result.trim())
		.update("|")
		.update(taskDescription.slice(0, 500))
		.update("|")
		.update(checkpointHash ?? "")
		.digest("hex")
}

function parseFinalizationEvidenceStatus(json: string | undefined): "passed" | "failed" | undefined {
	if (!json) return undefined
	try {
		const parsed = JSON.parse(json) as { status?: string }
		return parsed.status === "passed" ? "passed" : parsed.status === "failed" ? "failed" : undefined
	} catch {
		return undefined
	}
}

function parseCachedLifecycleState(
	raw: string | undefined,
): import("@shared/completion/completionLifecycle").GateLifecycleState | undefined {
	if (!raw) return undefined
	try {
		return (JSON.parse(raw) as { lifecycleState?: string }).lifecycleState as
			| import("@shared/completion/completionLifecycle").GateLifecycleState
			| undefined
	} catch {
		return undefined
	}
}

// ─── Decision Adapter ─────────────────────────────────────────────────────────

import { CompletionLifecycleDecisionEngine } from "./CompletionLifecycleDecisionEngine"
import type { CompletionLifecycleDecision } from "./CompletionLifecycleTypes"

/**
 * Evaluate the completion lifecycle for a TaskConfig and return one canonical decision.
 *
 * This is the single entry point that all handlers/utilities should call.
 * No other code should independently decide completion eligibility.
 */
export function evaluateCompletionLifecycle(
	config: TaskConfig,
	options?: {
		result?: string
		taskDescription?: string
		auditCacheKey?: string
		auditGateDecision?: AuditGateDecision
	},
): CompletionLifecycleDecision {
	const snapshot = buildCompletionSnapshot(config, options)
	return CompletionLifecycleDecisionEngine.evaluate(snapshot)
}
