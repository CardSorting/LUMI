/**
 * CompletionFunnel — the single auditable authority for task completion.
 *
 * Receives an immutable input snapshot and returns one canonical decision.
 * Snapshot construction, evaluation, enforcement, durable terminal commit,
 * publication, and terminal classification live in this module. Optional
 * documentation maintenance is external and explicitly non-authoritative.
 *
 * Architecture:
 *   evaluate(snapshot)
 *     → normalize inputs
 *     → validate active registry
 *     → evaluate audit validity (strict AND: cache key + graph revision + TTL + gate active)
 *     → evaluate workspace progress (checkpoint hash change detection)
 *     → evaluate duplicate attempt (fingerprint + workspace hash)
 *     → evaluate circuit breaker (block count threshold)
 *     → evaluate half-open probe eligibility (tripped + not verified + workspace changed + one per checkpoint)
 *     → return one current decision or one durable terminal outcome
 *     → return one canonical decision with full trace
 *
 * Industry patterns mirrored:
 * - Finite state machine for funnel transitions
 * - Circuit breaker / half-open probe (Hystrix, Envoy)
 * - CDN cache validation: all validity dimensions must match (AND, not OR)
 * - Idempotency-key duplicate suppression
 * - Single policy authority: the funnel collects, decides, commits, and publishes
 * - Structured decision traces (workflow engines, distributed systems debuggers)
 * - Fail-closed only for known active gates; fail-open for unknown/retired gates
 */

import { createHash, randomUUID } from "node:crypto"
import { formatResponse } from "@core/prompts/responses"
import type { AuditGateDecision } from "@shared/audit/auditGateReport"
import { COMPLETION_AUDIT_CACHE_TTL_MS, MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import {
	COMPLETION_FUNNEL_SCHEMA_VERSION,
	type CompletionFunnelEvent,
	type CompletionFunnelNextAction,
	type CompletionFunnelStage,
} from "@shared/completion/completionFunnelEvent"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import type { ExecutionFunnelEvent } from "@shared/execution/executionFunnelEvent"
import { CoordinationError, CoordinationErrorCode } from "@shared/governance/CoordinationErrors"
import type { LockClaim } from "@shared/governance/lockTypes"
import { isTaskLifecycleRecord } from "@shared/lifecycle/taskLifecycleEvent"
import { Logger } from "@shared/services/Logger"
import { configuredCoordinationAuthorityMode } from "@/core/governance/LockAuthority"
import { SWARM_LOCK_PROTOCOL_VERSION, SwarmMutexService } from "@/core/swarm/SwarmMutexService"
import { createTaskLifecycleIntentId, getTaskLifecycleAuthority } from "@/core/task/lifecycle/TaskLifecycleFunnel"
import { getCoordinationRawDb } from "@/infrastructure/db/Config"

import {
	getCompletionGraphRevision,
	getLatestCheckpointHashFromMessages,
	hashCompletionResult,
	resolveAuditStateIdentifier,
} from "../attemptCompletionUtils"
import type { TaskConfig } from "../types/TaskConfig"
import type { ToolResponse } from "../types/ToolContracts"

export interface RegisteredGate {
	id: string
	status: "active" | "retired"
	version?: number
}

export type GateRegistry = ReadonlyMap<string, RegisteredGate>

export interface CompletionFunnelRegistry {
	gates: GateRegistry
}

export interface CompletionFunnelSnapshot {
	readonly taskId: string
	readonly sessionId: string | undefined
	readonly checkpointHash: string | undefined
	readonly graphRevision: number
	readonly registry: CompletionFunnelRegistry
	readonly resultFingerprint: string | undefined
	readonly lastCompletionAttemptAt: number | undefined
	readonly lastCompletionAttemptGraphRevision: number | undefined
	readonly blockCount: number
	readonly lastGateBlockCheckpointHash: string | undefined
	readonly lastBlockedResultFingerprint: string | undefined
	readonly auditMetadata: TaskAuditMetadata | undefined
	readonly auditCacheKey: string | undefined
	readonly lastAuditCacheKey: string | undefined
	readonly auditCachedAt: number | undefined
	readonly auditGraphRevision: number | undefined
	readonly auditGateEnabled: boolean
	readonly auditGateDecision: AuditGateDecision | undefined
	readonly lastProbeCheckpointHash: string | undefined
	readonly now: number
}

export type CompletionDecisionKind = "allow_attempt" | "allow_probe" | "soft_block" | "hard_block" | "completed"
export type CompletionNextAction = CompletionFunnelNextAction
export type DecisionStage = CompletionFunnelStage

export type CompletionFunnelDecision = {
	kind: CompletionDecisionKind
	nextAllowedAction: CompletionNextAction
	forbiddenActions: CompletionNextAction[]
	canonicalInstruction: string
	reason: string
	stages: DecisionStage[]
} & (
	| { kind: "allow_attempt" }
	| { kind: "allow_probe" }
	| { kind: "soft_block"; playbook: string[] }
	| { kind: "hard_block"; playbook: string[] }
	| { kind: "completed"; decisionId?: string; committedAt?: number }
)

export type AuditValidityResult = "valid" | "invalidated" | "stale_pending_reconciliation" | "not_evaluated"

export interface AuditValidityEvaluation {
	result: AuditValidityResult
	stages: DecisionStage[]
	gateActive: boolean
}

const GATE_DEFINITIONS: RegisteredGate[] = [
	{ id: "audit", status: "active", version: 1 },
	{ id: "roadmap", status: "active", version: 1 },
	{ id: "focus_chain", status: "active", version: 1 },
	{ id: "quality", status: "active", version: 1 },
	{ id: "workspace_progress", status: "active", version: 1 },
	{ id: "duplicate", status: "active", version: 1 },
]

export const DEFAULT_GATE_REGISTRY: GateRegistry = new Map(GATE_DEFINITIONS.map((gate) => [gate.id, gate]))

export function buildGateRegistry(gates: RegisteredGate[]): GateRegistry {
	return new Map(gates.map((gate) => [gate.id, gate]))
}

export function isGateActive(registry: GateRegistry, gateId: string): boolean {
	return registry.get(gateId)?.status === "active"
}

export function isGateKnown(registry: GateRegistry, gateId: string): boolean {
	return registry.has(gateId)
}

// ─── Stage Result Helpers ─────────────────────────────────────────────────────

function pass(stage: string, reason: string, decisive = false): DecisionStage {
	return { stage, result: "passed", reason, decisive }
}

function fail(stage: string, reason: string, decisive = false): DecisionStage {
	return { stage, result: "failed", reason, decisive }
}

function _skip(stage: string, reason: string): DecisionStage {
	return { stage, result: "skipped", reason, decisive: false }
}

function na(stage: string, reason: string): DecisionStage {
	return { stage, result: "not_applicable", reason, decisive: false }
}

// ─── Audit Validity ───────────────────────────────────────────────────────────

/**
 * Evaluate audit validity using strict AND validation.
 *
 * All four dimensions must hold for "valid":
 *   1. Cache key matches (workspace fingerprint — includes checkpoint hash)
 *   2. Graph revision matches (meaningful state hasn't changed since cache)
 *   3. TTL valid (cached audit hasn't expired)
 *   4. Audit gate exists in the active registry
 *
 * If any dimension fails, the audit is "invalidated" or "stale_pending_reconciliation".
 * Unknown or retired audit gates are treated as non-participating — the audit
 * is "not_evaluated" rather than "invalidated" (fail-open for retired gates).
 *
 * Mirrors CDN cache validation: ETag (cache key) + Last-Modified (graph
 * revision) + Cache-Control max-age (TTL) + origin server healthy (gate active).
 */
export function evaluateAuditValidity(snapshot: CompletionFunnelSnapshot): AuditValidityEvaluation {
	const stages: DecisionStage[] = []

	// No audit metadata — not evaluated
	if (!snapshot.auditMetadata) {
		stages.push(na("audit_validity", "No audit metadata cached"))
		return { result: "not_evaluated", stages, gateActive: false }
	}

	// Dimension 1: Cache key match
	const cacheKeyMatches = snapshot.lastAuditCacheKey === snapshot.auditCacheKey
	if (!cacheKeyMatches) {
		stages.push(fail("audit_validity.cache_key", "Audit cache key mismatch — workspace fingerprint changed", true))
		return { result: "invalidated", stages, gateActive: snapshot.auditGateEnabled }
	}
	stages.push(pass("audit_validity.cache_key", "Cache key matches current workspace fingerprint"))

	// Dimension 2: Graph revision match
	const graphRevisionMatches = snapshot.auditGraphRevision === snapshot.graphRevision
	if (!graphRevisionMatches) {
		stages.push(
			fail(
				"audit_validity.graph_revision",
				"Graph revision mismatch — meaningful state changed since audit was cached",
				true,
			),
		)
		return { result: "invalidated", stages, gateActive: snapshot.auditGateEnabled }
	}
	stages.push(pass("audit_validity.graph_revision", "Graph revision matches audit cache revision"))

	// Dimension 3: TTL valid
	const ttlValid = snapshot.auditCachedAt !== undefined && snapshot.now - snapshot.auditCachedAt < COMPLETION_AUDIT_CACHE_TTL_MS
	if (!ttlValid) {
		stages.push(fail("audit_validity.ttl", "Audit cache TTL expired — stale pending reconciliation", true))
		return { result: "stale_pending_reconciliation", stages, gateActive: snapshot.auditGateEnabled }
	}
	stages.push(
		pass(
			"audit_validity.ttl",
			`TTL valid (${snapshot.now - (snapshot.auditCachedAt ?? 0)}ms elapsed, ${COMPLETION_AUDIT_CACHE_TTL_MS}ms limit)`,
		),
	)

	// Dimension 4: Gate active in registry
	const gateActive = snapshot.auditGateEnabled && isGateActive(snapshot.registry.gates, "audit")
	if (!gateActive) {
		// Unknown or retired audit gate — non-participating, not blocking
		const known = isGateKnown(snapshot.registry.gates, "audit")
		stages.push(
			na(
				"audit_validity.gate_registry",
				known ? "Audit gate retired — non-participating" : "Audit gate unknown — non-participating",
			),
		)
		return { result: "not_evaluated", stages, gateActive: false }
	}
	stages.push(pass("audit_validity.gate_registry", "Audit gate active in registry"))

	return { result: "valid", stages, gateActive: true }
}

// ─── Workspace Progress ───────────────────────────────────────────────────────

/**
 * Evaluate whether the workspace has changed since the last gate block.
 *
 * Returns true if the workspace HAS changed (progress detected), false if
 * unchanged.  Used by the engine to:
 * - Block retries with unchanged workspace (soft block, no circuit breaker budget)
 * - Allow half-open probe attempts (circuit breaker half-open state)
 *
 * Rewording completion text does not bypass this check — the checkpoint hash
 * tracks workspace state, not result text.
 */
export function hasWorkspaceProgress(snapshot: CompletionFunnelSnapshot): boolean {
	if (!snapshot.lastGateBlockCheckpointHash || !snapshot.checkpointHash) {
		// No prior block hash — can't determine, treat as "no progress" (safe default)
		return false
	}
	return snapshot.lastGateBlockCheckpointHash !== snapshot.checkpointHash
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

/**
 * Evaluate duplicate attempt — uses BOTH result fingerprint AND workspace
 * checkpoint hash.  Mirrors idempotency-key style duplicate suppression.
 *
 * Returns true if this is a duplicate (same fingerprint AND same workspace),
 * false otherwise.
 */
export function isDuplicateAttempt(snapshot: CompletionFunnelSnapshot): boolean {
	if (snapshot.blockCount === 0 || !snapshot.lastBlockedResultFingerprint) {
		return false
	}
	if (snapshot.resultFingerprint !== snapshot.lastBlockedResultFingerprint) {
		// Different result text — not a duplicate
		return false
	}
	// Same result text — check if workspace also unchanged
	return !hasWorkspaceProgress(snapshot)
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

/**
 * Evaluate circuit breaker state.
 *
 * Returns "closed" (normal), "tripped" (hard stop), or "half_open" (probe allowed).
 *
 * Half-open behavior (mirrors Hystrix / Envoy):
 * - Tripped + workspace changed → "half_open"
 * - Tripped + workspace unchanged → "tripped"
 *
 * Half-open is deterministic: exactly one probe is allowed per checkpoint
 * (tracked via lastProbeCheckpointHash).
 */
export function evaluateCircuitBreaker(snapshot: CompletionFunnelSnapshot): {
	state: "closed" | "tripped" | "half_open"
	stages: DecisionStage[]
} {
	const stages: DecisionStage[] = []

	if (snapshot.blockCount < MAX_COMPLETION_GATE_BLOCK_COUNT) {
		stages.push(pass("circuit_breaker", `Closed (${snapshot.blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT} blocks)`))
		return { state: "closed", stages }
	}

	stages.push(fail("circuit_breaker", `Tripped (${snapshot.blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT} blocks)`))

	// Check if workspace changed for a half-open probe.
	const workspaceChanged = hasWorkspaceProgress(snapshot)
	if (!workspaceChanged) {
		stages.push(fail("circuit_breaker.probe", "Workspace unchanged — no probe allowed, stay tripped"))
		return { state: "tripped", stages }
	}

	// Workspace changed — check if this checkpoint already had a probe
	if (snapshot.lastProbeCheckpointHash === snapshot.checkpointHash) {
		stages.push(fail("circuit_breaker.probe", "Probe already used for this checkpoint — stay tripped", true))
		return { state: "tripped", stages }
	}

	stages.push(pass("circuit_breaker.probe", "Workspace changed — half-open probe allowed", true))
	return { state: "half_open", stages }
}

// ─── Pure funnel policy ──────────────────────────────────────────────────────

/**
 * The deterministic pure policy inside the completion funnel.
 *
 * Evaluate an immutable snapshot and return one canonical decision.
 * Every decision emits a structured trace showing each evaluated stage,
 * input state, result, and reason.
 *
 * This layer is pure — no side effects and no mutable state reads. The public
 * funnel below owns normalization, the remaining gates, durable commit, and
 * event publication.
 */
export const CompletionFunnelEvaluator = {
	/**
	 * Evaluate a completion funnel snapshot and return one core policy decision.
	 *
	 * Pipeline (each stage adds to the trace):
	 *   1. Normalize inputs
	 *   2. Validate active registry
	 *   3. Evaluate audit validity (strict AND)
	 *   4. Evaluate workspace progress
	 *   5. Evaluate duplicate attempt
	 *   6. Evaluate circuit breaker
	 *   7. Evaluate half-open probe eligibility
	 *   8. Return one canonical decision
	 */
	evaluate(snapshot: CompletionFunnelSnapshot): CompletionFunnelDecision {
		const stages: DecisionStage[] = []

		// ── Stage 1: Normalize inputs ──
		stages.push(
			pass("normalize", `Task ${snapshot.taskId}, revision ${snapshot.graphRevision}, blocks ${snapshot.blockCount}`),
		)

		// ── Stage 2: Validate active registry ──
		const auditGateKnown = isGateKnown(snapshot.registry.gates, "audit")
		if (!auditGateKnown && snapshot.auditGateEnabled) {
			stages.push(na("registry", "Audit gate not in registry — treating as non-participating"))
		} else {
			stages.push(pass("registry", "Active gate registry validated"))
		}

		// ── Stage 3: Evaluate audit validity ──
		const auditValidity = evaluateAuditValidity(snapshot)
		stages.push(...auditValidity.stages)

		// ── Stage 6: Evaluate circuit breaker ──
		const circuitBreaker = evaluateCircuitBreaker(snapshot)
		stages.push(...circuitBreaker.stages)

		// Circuit breaker tripped (not half-open) → hard block
		if (circuitBreaker.state === "tripped") {
			stages.push(fail("core_policy", "Circuit breaker tripped — hard block", true))
			return {
				kind: "hard_block" as const,
				nextAllowedAction: "stop_and_report" as const,
				forbiddenActions: ["attempt_completion"] as const,
				canonicalInstruction:
					"Stop calling attempt_completion. Make workspace changes for a probe attempt, or present results via act_mode_respond.",
				reason:
					`Maximum completion gate retries (${MAX_COMPLETION_GATE_BLOCK_COUNT}) exceeded. ` +
					"Make substantive workspace changes (checkpoint hash must change) for a probe attempt, " +
					"or use act_mode_respond to present results.",
				playbook: [
					"Stop calling attempt_completion — further calls will fail unless workspace changes.",
					"Make substantive code changes (checkpoint hash must change) — circuit breaker opens for one probe.",
					"If the probe passes, the funnel can commit one terminal result.",
					"If violations cannot be fixed, present results via act_mode_respond.",
				],
				stages,
			}
		}

		// Circuit breaker half-open → allow probe
		if (circuitBreaker.state === "half_open") {
			stages.push(pass("core_policy", "Circuit breaker half-open — probe allowed"))
			return {
				kind: "allow_probe" as const,
				nextAllowedAction: "attempt_completion" as const,
				forbiddenActions: [] as const,
				canonicalInstruction:
					"Call attempt_completion now. This is a half-open probe — one attempt allowed for this checkpoint.",
				reason:
					"Circuit breaker half-open: workspace changed since last block. " +
					"One probe attempt is allowed for this checkpoint.",
				stages,
			}
		}

		// ── Stage 4: Evaluate workspace progress ──
		if (snapshot.blockCount > 0) {
			const workspaceChanged = hasWorkspaceProgress(snapshot)
			if (!workspaceChanged && snapshot.lastGateBlockCheckpointHash) {
				stages.push(
					fail("workspace_progress", "Workspace unchanged since last gate block — rewording result won't help", true),
				)
				return {
					kind: "soft_block" as const,
					nextAllowedAction: "modify_workspace" as const,
					forbiddenActions: ["attempt_completion"] as const,
					canonicalInstruction:
						"Do not call attempt_completion. Modify the workspace (code changes required), then retry.",
					reason:
						"Completion blocked: the workspace hasn't changed since the last gate block. " +
						"Rewording the result summary won't change the audit outcome. " +
						"Make substantive fixes to the code (checkpoint hash must change), then retry.",
					playbook: [
						"Make actual code changes — rewording the result summary won't fix audit violations.",
						"Verify the checkpoint hash changed (via git status or a test run) before retrying.",
						"If violations cannot be fixed, stop and report the blocking evidence.",
					],
					stages,
				}
			}
			stages.push(pass("workspace_progress", "Workspace changed since last gate block"))
		} else {
			stages.push(na("workspace_progress", "No prior blocks — skipping"))
		}

		// ── Stage 5: Evaluate duplicate attempt ──
		if (isDuplicateAttempt(snapshot)) {
			stages.push(fail("duplicate_check", "Same result fingerprint AND same workspace checkpoint — duplicate", true))
			return {
				kind: "soft_block" as const,
				nextAllowedAction: "modify_workspace" as const,
				forbiddenActions: ["attempt_completion"] as const,
				canonicalInstruction:
					"Do not call attempt_completion. Modify the workspace (code changes required), then retry with an updated result.",
				reason:
					"Duplicate completion submission: the same result was re-submitted after a gate block with no workspace changes. " +
					"Fix violations in the workspace and update your result before retrying.",
				playbook: [
					"Make substantive fixes in the workspace — do not retry the same summary.",
					"Verify changes with git status or tests before retrying.",
					"If violations cannot be fixed, stop and report the blocking evidence.",
				],
				stages,
			}
		}
		stages.push(pass("duplicate_check", "Not a duplicate attempt"))

		// ── Stage 7: Half-open probe already handled above ──
		// (circuit breaker stage handles half-open probe eligibility)

		// ── All stages passed → allow attempt ──
		// Check if we can take the fast path (audit valid + no blocks + ready)
		const canFastPath =
			auditValidity.result === "valid" &&
			snapshot.blockCount === 0 &&
			(snapshot.lastCompletionAttemptGraphRevision === undefined ||
				snapshot.lastCompletionAttemptGraphRevision === snapshot.graphRevision)

		stages.push(pass("core_policy", canFastPath ? "Core policy passed — fast path eligible" : "Core policy passed"))

		return {
			kind: "allow_attempt" as const,
			nextAllowedAction: "attempt_completion" as const,
			forbiddenActions: [] as const,
			canonicalInstruction: "Call attempt_completion now.",
			reason: canFastPath
				? "Completion allowed — audit valid, no blocks, fast path eligible."
				: "Completion allowed — all gate stages passed.",
			stages,
		}
	},
}

// ─── Snapshot Builder ─────────────────────────────────────────────────────────

/**
 * Builder helper for creating a snapshot from partial inputs.
 * Used by adapters that normalize TaskConfig/TaskState into a snapshot.
 */
export function buildSnapshot(input: CompletionFunnelSnapshot): CompletionFunnelSnapshot {
	return Object.freeze({ ...input }) as CompletionFunnelSnapshot
}

// ─── Snapshot ownership ──────────────────────────────────────────────────────

function hashCompletionAuditInput(result: string, taskDescription: string, checkpointHash?: string): string {
	return createHash("sha256")
		.update(result.trim())
		.update("|")
		.update(taskDescription.slice(0, 500))
		.update("|")
		.update(checkpointHash ?? "")
		.digest("hex")
}

export function buildCompletionSnapshot(
	config: TaskConfig,
	options?: {
		result?: string
		taskDescription?: string
		auditCacheKey?: string
		auditGateDecision?: AuditGateDecision
		checkpointHash?: string
	},
): CompletionFunnelSnapshot {
	const checkpointHash = options?.checkpointHash ?? getLatestCheckpointHashFromMessages(config)
	const graphRevision = getCompletionGraphRevision(config)
	const taskDescription = options?.taskDescription ?? ""
	const auditCacheKey =
		options?.auditCacheKey ??
		(options?.result ? hashCompletionAuditInput(options.result, taskDescription, checkpointHash) : undefined)

	return {
		taskId: config.taskId,
		sessionId: config.taskState.completionGateSessionId,
		checkpointHash,
		graphRevision,
		registry: { gates: DEFAULT_GATE_REGISTRY },
		resultFingerprint: options?.result ? hashCompletionResult(options.result) : undefined,
		lastCompletionAttemptAt: config.taskState.lastCompletionAttemptAt,
		lastCompletionAttemptGraphRevision: config.taskState.lastCompletionAttemptGraphRevision,
		// Historical advisory counters are intentionally excluded. Only state
		// produced by this funnel may acquire completion authority.
		blockCount: 0,
		lastGateBlockCheckpointHash: undefined,
		lastBlockedResultFingerprint: undefined,
		auditMetadata: config.taskState.lastCompletionAudit,
		auditCacheKey,
		lastAuditCacheKey: config.taskState.lastCompletionAuditCacheKey,
		auditCachedAt: config.taskState.lastCompletionAuditCachedAt,
		auditGraphRevision: config.taskState.lastCompletionAuditGraphRevision,
		auditGateEnabled: config.auditCompletionGateEnabled ?? false,
		auditGateDecision: options?.auditGateDecision,
		lastProbeCheckpointHash: undefined,
		now: Date.now(),
	}
}

export function evaluateCompletionFunnel(
	config: TaskConfig,
	options?: {
		result?: string
		taskDescription?: string
		auditCacheKey?: string
		auditGateDecision?: AuditGateDecision
	},
): CompletionFunnelDecision {
	const cached = getCachedCompletionFunnelEvent(config)
	if (cached?.terminal) {
		return {
			kind: "completed",
			nextAllowedAction: "none",
			forbiddenActions: ["attempt_completion"],
			canonicalInstruction: "Task completion is already committed. No completion action remains.",
			reason: cached.reason,
			stages: cached.stages,
			decisionId: cached.decisionId,
			committedAt: cached.committedAt,
		}
	}
	return CompletionFunnelEvaluator.evaluate(buildCompletionSnapshot(config, options))
}

// ─── Boundary guard ──────────────────────────────────────────────────────────

const TOOL_TO_ACTION: ReadonlyMap<string, CompletionNextAction> = new Map([["attempt_completion", "attempt_completion"]])

export type GuardResult =
	| { allowed: true; decision: CompletionFunnelDecision }
	| { allowed: false; decision: CompletionFunnelDecision; rejection: ToolResponse }

export function guardCompletionAction(requestedTool: string, decision: CompletionFunnelDecision): GuardResult {
	const requestedAction = TOOL_TO_ACTION.get(requestedTool)
	if (!requestedAction) return { allowed: true, decision }
	if (
		decision.forbiddenActions.includes(requestedAction) ||
		(decision.nextAllowedAction !== requestedAction && decision.nextAllowedAction !== "none") ||
		decision.kind === "completed"
	) {
		return {
			allowed: false,
			decision,
			rejection: formatResponse.toolError(
				`Action "${requestedAction}" is not permitted. Decision: ${decision.kind}. ` +
					`Required next action: ${decision.nextAllowedAction}. ${decision.canonicalInstruction}`,
			),
		}
	}
	return { allowed: true, decision }
}

export function guardAttemptCompletion(config: TaskConfig, decision = evaluateCompletionFunnel(config)): GuardResult {
	return guardCompletionAction("attempt_completion", decision)
}

// ─── Durable terminal authority ──────────────────────────────────────────────

export const COMPLETION_DECISION_SCHEMA_VERSION = 1
export type TaskCompletionStatus = "succeeded" | "failed" | "cancelled"

export interface CompletionDecisionIdentityInput {
	taskId: string
	evaluatedStateVersion: number
	checkpoint: string
	outcome: TaskCompletionStatus
	decisionSchemaVersion: number
}

export interface TaskCompletionRecord {
	taskId: string
	decisionId: string
	status: TaskCompletionStatus
	evaluatedStateVersion: number
	evaluatedCheckpointJson: string
	decisionJson: string
	ownerId: string
	leaseEpoch: string
	fencingToken: string
	committedAt: number
}

export interface CompletionRawDatabase {
	exec(sql: string): void
	prepare(sql: string): {
		get(...parameters: unknown[]): unknown
		run(...parameters: unknown[]): { changes: number }
	}
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const child = (value as Record<string, unknown>)[key]
			if (child !== undefined) result[key] = canonicalize(child)
		}
		return result
	}
	return typeof value === "bigint" ? value.toString() : value
}

export function canonicalCompletionJson(value: unknown): string {
	return JSON.stringify(canonicalize(value))
}

export function canonicalDecisionId(input: CompletionDecisionIdentityInput): string {
	return createHash("sha256").update(canonicalCompletionJson(input)).digest("hex")
}

function parseCompletionRecord(row: unknown): TaskCompletionRecord {
	const record = row as Partial<TaskCompletionRecord>
	if (
		!record ||
		typeof record.taskId !== "string" ||
		typeof record.decisionId !== "string" ||
		(record.status !== "succeeded" && record.status !== "failed" && record.status !== "cancelled") ||
		!Number.isInteger(record.evaluatedStateVersion) ||
		typeof record.evaluatedCheckpointJson !== "string" ||
		typeof record.decisionJson !== "string" ||
		typeof record.ownerId !== "string" ||
		typeof record.leaseEpoch !== "string" ||
		typeof record.fencingToken !== "string" ||
		!Number.isFinite(record.committedAt)
	) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			"Malformed task completion record.",
			"fail_closed",
		)
	}
	let checkpoint: unknown
	try {
		checkpoint = JSON.parse(record.evaluatedCheckpointJson)
		JSON.parse(record.decisionJson)
	} catch (error) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Task completion '${record.taskId}' contains invalid JSON.`,
			"fail_closed",
			undefined,
			error,
		)
	}
	if (
		!checkpoint ||
		typeof checkpoint !== "object" ||
		typeof (checkpoint as { checkpoint?: unknown }).checkpoint !== "string"
	) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Task completion '${record.taskId}' has an invalid checkpoint payload.`,
			"fail_closed",
		)
	}
	const expectedDecisionId = canonicalDecisionId({
		taskId: record.taskId,
		evaluatedStateVersion: record.evaluatedStateVersion as number,
		checkpoint: (checkpoint as { checkpoint: string }).checkpoint,
		outcome: record.status,
		decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
	})
	if (expectedDecisionId !== record.decisionId) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Task completion '${record.taskId}' failed decision digest validation.`,
			"fail_closed",
		)
	}
	return record as TaskCompletionRecord
}

export async function durableGetTaskCompletion(taskId: string): Promise<TaskCompletionRecord | undefined> {
	let rawDb: CompletionRawDatabase
	try {
		rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
	} catch (error) {
		throw new CoordinationError(
			CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
			"SQLite authority unavailable while reading task completion.",
			"retry",
			undefined,
			error,
		)
	}
	const row = rawDb.prepare("SELECT * FROM task_completions WHERE taskId = ?").get(taskId)
	return row ? parseCompletionRecord(row) : undefined
}

export interface CommitTaskCompletionInput {
	record: TaskCompletionRecord
	resourceKey: string
	currentStateVersion: () => number
}

export type CommitTaskCompletionResult = {
	kind: "committed" | "idempotent" | "duplicate_suppressed"
	record: TaskCompletionRecord
}

export function commitTaskCompletionTransaction(
	rawDb: CompletionRawDatabase,
	input: CommitTaskCompletionInput,
): CommitTaskCompletionResult {
	rawDb.exec("BEGIN IMMEDIATE")
	try {
		const lease = rawDb.prepare("SELECT * FROM swarm_locks WHERE resource = ?").get(input.resourceKey) as
			| Record<string, unknown>
			| undefined
		if (
			!lease ||
			lease.ownerId !== input.record.ownerId ||
			lease.leaseEpoch !== input.record.leaseEpoch ||
			lease.fencingToken !== input.record.fencingToken ||
			lease.authorityMode !== "sqlite" ||
			Number(lease.protocolVersion) !== SWARM_LOCK_PROTOCOL_VERSION ||
			Number(lease.expiresAt) < Date.now()
		) {
			throw new CoordinationError(
				CoordinationErrorCode.FENCING_TOKEN_REJECTED,
				"Completion lease ownership, epoch, token, protocol, or expiry validation failed.",
				"abort_owner",
			)
		}
		const generation = rawDb
			.prepare("SELECT highestLeaseEpoch, highestFencingToken FROM swarm_lock_generations WHERE resourceKey = ?")
			.get(input.resourceKey) as Record<string, unknown> | undefined
		if (
			!generation ||
			generation.highestLeaseEpoch !== input.record.leaseEpoch ||
			generation.highestFencingToken !== input.record.fencingToken
		) {
			throw new CoordinationError(
				CoordinationErrorCode.FENCING_TOKEN_REJECTED,
				"Completion lease is not the freshest allocated generation.",
				"abort_owner",
			)
		}
		if (input.currentStateVersion() !== input.record.evaluatedStateVersion) {
			throw new CoordinationError(
				CoordinationErrorCode.OWNERSHIP_CHANGED,
				"Task state changed after completion evaluation.",
				"abort_owner",
			)
		}

		const existingRaw = rawDb.prepare("SELECT * FROM task_completions WHERE taskId = ?").get(input.record.taskId)
		if (existingRaw) {
			const existing = parseCompletionRecord(existingRaw)
			if (existing.decisionId === input.record.decisionId) {
				if (
					existing.decisionJson !== input.record.decisionJson ||
					existing.evaluatedCheckpointJson !== input.record.evaluatedCheckpointJson ||
					existing.status !== input.record.status
				) {
					throw new CoordinationError(
						CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
						"The same completion decision ID has a different payload.",
						"fail_closed",
					)
				}
				rawDb.exec("COMMIT")
				return { kind: "idempotent", record: existing }
			}
			if (existing.status === input.record.status) {
				rawDb.exec("COMMIT")
				return { kind: "duplicate_suppressed", record: existing }
			}
			throw new CoordinationError(
				CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
				`Terminal conflict: existing status '${existing.status}', proposed '${input.record.status}'.`,
				"fail_closed",
			)
		}

		rawDb
			.prepare(
				`INSERT INTO task_completions (
					taskId, decisionId, status, evaluatedStateVersion, evaluatedCheckpointJson,
					decisionJson, ownerId, leaseEpoch, fencingToken, committedAt
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.record.taskId,
				input.record.decisionId,
				input.record.status,
				input.record.evaluatedStateVersion,
				input.record.evaluatedCheckpointJson,
				input.record.decisionJson,
				input.record.ownerId,
				input.record.leaseEpoch,
				input.record.fencingToken,
				input.record.committedAt,
			)
		rawDb.exec("COMMIT")
		return { kind: "committed", record: input.record }
	} catch (error) {
		try {
			rawDb.exec("ROLLBACK")
		} catch {}
		throw error
	}
}

// ─── One event cache and publication path ────────────────────────────────────

export function getCachedCompletionFunnelEventFromState(taskState: {
	completionFunnelEventJson?: string
}): CompletionFunnelEvent | undefined {
	const raw = taskState.completionFunnelEventJson
	if (!raw) return undefined
	try {
		const parsed = JSON.parse(raw) as CompletionFunnelEvent
		return parsed.schemaVersion === COMPLETION_FUNNEL_SCHEMA_VERSION ? parsed : undefined
	} catch {
		return undefined
	}
}

export function getCachedCompletionFunnelEvent(config: TaskConfig): CompletionFunnelEvent | undefined {
	return getCachedCompletionFunnelEventFromState(config.taskState)
}

export function decisionToCompletionFunnelEvent(
	config: TaskConfig,
	decision: CompletionFunnelDecision,
	terminal?: { decisionId: string; committedAt: number },
): CompletionFunnelEvent {
	const completed = decision.kind === "completed" || terminal !== undefined
	return {
		schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
		taskId: config.taskId,
		phase: completed
			? "completed"
			: decision.kind === "allow_attempt" || decision.kind === "allow_probe"
				? "ready"
				: decision.kind === "hard_block"
					? "failed"
					: "blocked",
		kind: completed ? "completed" : decision.kind,
		terminal: completed,
		nextAllowedAction: completed ? "none" : decision.nextAllowedAction,
		forbiddenActions: completed ? ["attempt_completion"] : [...decision.forbiddenActions],
		canonicalInstruction: completed
			? "Task completion is committed. No completion action remains."
			: decision.canonicalInstruction,
		reason: completed ? "The authoritative completion transaction committed successfully." : decision.reason,
		stages: completed
			? [...decision.stages, pass("terminal_commit", "Durable completion committed", true)]
			: [...decision.stages],
		graphRevision: getCompletionGraphRevision(config),
		evaluatedAt: Date.now(),
		decisionId: terminal?.decisionId ?? (decision.kind === "completed" ? decision.decisionId : undefined),
		committedAt: terminal?.committedAt ?? (decision.kind === "completed" ? decision.committedAt : undefined),
	}
}

export function cacheCompletionFunnelEvent(config: TaskConfig, event: CompletionFunnelEvent): CompletionFunnelEvent {
	const existing = getCachedCompletionFunnelEvent(config)
	const accepted = existing?.terminal ? existing : event
	config.taskState.completionFunnelEventJson = JSON.stringify(accepted)
	if (accepted.terminal) {
		config.taskState.lastCompletionDecisionId = accepted.decisionId
	}
	return accepted
}

export async function publishCompletionFunnelEvent(config: TaskConfig, event: CompletionFunnelEvent): Promise<void> {
	const accepted = cacheCompletionFunnelEvent(config, event)
	try {
		await config.callbacks.say(
			"info",
			accepted.terminal ? "Completion recorded" : accepted.canonicalInstruction,
			undefined,
			undefined,
			false,
			undefined,
			accepted,
		)
	} catch {
		// Publication is best-effort. The cache and durable terminal record remain authoritative.
	}
}

export function isTaskHarnessTerminal(taskState: { lifecycleFunnelRecordJson?: string }): boolean {
	if (!taskState.lifecycleFunnelRecordJson) return false
	try {
		const record = JSON.parse(taskState.lifecycleFunnelRecordJson) as unknown
		return isTaskLifecycleRecord(record) && record.state === "terminal"
	} catch {
		return false
	}
}

export async function commitCompletionLifecycleFact(config: TaskConfig, decisionId: string, committedAt: number): Promise<void> {
	const authority = getTaskLifecycleAuthority(config.taskState)
	let current = authority.readProjection(config.taskState) ?? (await authority.restore(config.taskState, config.taskId))
	if (!current) {
		const activated = await authority.ensureActive(config.taskState, config.taskId, {
			source: "completion_funnel",
			reason: "Completion evaluation requires a registered active lifecycle generation.",
			originatingOperationId: decisionId,
		})
		if (activated.kind === "rejected") {
			throw new Error(`Lifecycle activation rejected (${activated.code}): ${activated.reason}`)
		}
		current = activated.record
	}
	if (current.state === "terminal") {
		if (current.terminalOutcome === "completed") return
		throw new Error(
			`Lifecycle terminal conflict: generation '${current.generationId}' is already '${current.terminalOutcome}'.`,
		)
	}
	const lifecycleResult = await authority.submit(config.taskState, {
		type: "SettleCompletion",
		intentId: createTaskLifecycleIntentId(),
		taskId: config.taskId,
		generationId: current.generationId,
		cause: {
			source: "completion_funnel",
			reason: "CompletionFunnel durably committed the semantic completion fact.",
			originatingOperationId: decisionId,
			authoritativeAt: committedAt,
		},
	})
	if (lifecycleResult.kind === "rejected") {
		throw new Error(`Lifecycle completion rejected (${lifecycleResult.code}): ${lifecycleResult.reason}`)
	}
}

// ─── Full attempt funnel: collect → decide → CAS → publish ───────────────────

export interface CompletionDecision {
	status: "approved" | "blocked_recoverable" | "blocked_hard"
	code:
		| "COMPLETION_APPROVED"
		| "ROADMAP_REMEDIATION_REQUIRED"
		| "AUDIT_REQUIRED"
		| "ACTIVE_WORK_REMAINS"
		| "VERIFICATION_FAILED"
	nextTransition: "TERMINAL_SUCCESS" | "REMEDIATE_ROADMAP" | "RUN_AUDIT" | "RETURN_TO_EXECUTION" | "TERMINAL_FAILURE"
	stateVersion: number
	decisionId: string
	details?: Record<string, unknown>
}

interface CompletionFunnelEvaluation {
	decision: CompletionDecision
	funnelDecision: CompletionFunnelDecision
}

async function evaluateCompletionDecision(
	config: TaskConfig,
	result: string,
	taskDescription: string,
	decisionId: string,
	stateVersion: number,
): Promise<CompletionFunnelEvaluation> {
	const coreDecision = evaluateCompletionFunnel(config, { result, taskDescription, auditCacheKey: decisionId })
	if (coreDecision.kind === "hard_block") {
		return {
			decision: {
				status: "blocked_hard",
				code: "VERIFICATION_FAILED",
				nextTransition: "TERMINAL_FAILURE",
				stateVersion,
				decisionId,
				details: { blocker: coreDecision.reason },
			},
			funnelDecision: coreDecision,
		}
	}
	if (coreDecision.kind === "soft_block") {
		return {
			decision: {
				status: "blocked_recoverable",
				code: "AUDIT_REQUIRED",
				nextTransition: "RUN_AUDIT",
				stateVersion,
				decisionId,
				details: { blocker: coreDecision.reason },
			},
			funnelDecision: coreDecision,
		}
	}
	if (coreDecision.kind === "completed") {
		return {
			decision: {
				status: "approved",
				code: "COMPLETION_APPROVED",
				nextTransition: "TERMINAL_SUCCESS",
				stateVersion,
				decisionId: coreDecision.decisionId ?? decisionId,
			},
			funnelDecision: coreDecision,
		}
	}

	const funnelStages = [...coreDecision.stages]
	try {
		const { evaluateRoadmapCompletionBlock } = require("@/services/roadmap/RoadmapCompletionGate")
		const roadmapBlock = await evaluateRoadmapCompletionBlock(config.cwd)
		if (roadmapBlock.blocked) {
			const reason = roadmapBlock.message || "ROADMAP steering gate closed."
			return {
				decision: {
					status: "blocked_recoverable",
					code: "ROADMAP_REMEDIATION_REQUIRED",
					nextTransition: "REMEDIATE_ROADMAP",
					stateVersion,
					decisionId,
					details: { blocker: reason, remediationSteps: roadmapBlock.remediationSteps },
				},
				funnelDecision: {
					kind: "soft_block",
					nextAllowedAction: "modify_workspace",
					forbiddenActions: ["attempt_completion"],
					canonicalInstruction: reason,
					reason,
					playbook: Array.isArray(roadmapBlock.remediationSteps)
						? roadmapBlock.remediationSteps
						: ["Complete the ROADMAP remediation recorded in the funnel trace."],
					stages: [...funnelStages, fail("roadmap", reason, true)],
				},
			}
		}
		funnelStages.push(pass("roadmap", "Roadmap completion requirements passed"))
	} catch {
		funnelStages.push(na("roadmap", "Roadmap provider unavailable — non-participating"))
	}

	if (config.taskState.swarmRuntime && config.taskState.swarmRuntime.lanesComplete < config.taskState.swarmRuntime.lanesTotal) {
		const reason = "Swarm has active, unsealed lanes remaining."
		return {
			decision: {
				status: "blocked_recoverable",
				code: "ACTIVE_WORK_REMAINS",
				nextTransition: "RETURN_TO_EXECUTION",
				stateVersion,
				decisionId,
				details: {
					blocker: reason,
					lanesComplete: config.taskState.swarmRuntime.lanesComplete,
					lanesTotal: config.taskState.swarmRuntime.lanesTotal,
				},
			},
			funnelDecision: {
				kind: "soft_block",
				nextAllowedAction: "continue_execution",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: "Continue execution until every required swarm lane is sealed.",
				reason,
				playbook: ["Wait for or complete every required swarm lane, then submit one new completion attempt."],
				stages: [...funnelStages, fail("swarm", reason, true)],
			},
		}
	}
	funnelStages.push(pass("swarm", "No active required swarm lanes remain"))
	funnelStages.push(pass("decision", "Every completion funnel stage passed", true))
	return {
		decision: {
			status: "approved",
			code: "COMPLETION_APPROVED",
			nextTransition: "TERMINAL_SUCCESS",
			stateVersion,
			decisionId,
		},
		funnelDecision: { ...coreDecision, stages: funnelStages },
	}
}

export interface CompletionAttemptRecord {
	completionAttemptId: string
	taskId: string
	generationId: string
	originatingInvocationId: string
	phase:
		| "prepared"
		| "evidence_pending"
		| "evidence_dispatching"
		| "evidence_succeeded"
		| "evidence_failed"
		| "proposal_pending"
		| "decision_accepted"
		| "decision_rejected"
		| "settling"
		| "completed"
		| "settlement_failed"
		| "stale"
	evidenceRequestId: string | null
	evidenceInvocationId: string | null
	evidenceExecutionEventId: string | null
	commandIntentJson: string | null
	commandDigest: string | null
	expectedLifecycleRevision: number
	evaluatedStateVersion: number | null
	proposalEventId: string | null
	decisionId: string | null
	version: number
	createdAt: number
	updatedAt: number
}

export async function getCompletionAttempt(completionAttemptId: string): Promise<CompletionAttemptRecord | undefined> {
	try {
		const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
		return rawDb.prepare("SELECT * FROM completion_attempts WHERE completionAttemptId = ?").get(completionAttemptId) as
			| CompletionAttemptRecord
			| undefined
	} catch (error) {
		Logger.error(`[CompletionFunnel] Failed to get completion attempt ${completionAttemptId}:`, error)
		return undefined
	}
}

export async function insertCompletionAttempt(record: CompletionAttemptRecord): Promise<void> {
	try {
		const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
		rawDb
			.prepare(
				`INSERT INTO completion_attempts (
					completionAttemptId, taskId, generationId, originatingInvocationId,
					phase, evidenceRequestId, evidenceInvocationId, evidenceExecutionEventId,
					commandIntentJson, commandDigest, expectedLifecycleRevision, evaluatedStateVersion,
					proposalEventId, decisionId, version, createdAt, updatedAt
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.completionAttemptId,
				record.taskId,
				record.generationId,
				record.originatingInvocationId,
				record.phase,
				record.evidenceRequestId,
				record.evidenceInvocationId,
				record.evidenceExecutionEventId,
				record.commandIntentJson,
				record.commandDigest,
				record.expectedLifecycleRevision,
				record.evaluatedStateVersion,
				record.proposalEventId,
				record.decisionId,
				record.version,
				record.createdAt,
				record.updatedAt,
			)
	} catch (error) {
		Logger.error(`[CompletionFunnel] Failed to insert completion attempt:`, error)
		throw error
	}
}

export async function updateCompletionAttemptCAS(
	expectedVersion: number,
	record: Partial<CompletionAttemptRecord> & { completionAttemptId: string },
): Promise<boolean> {
	try {
		const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
		const keys = Object.keys(record).filter((k) => k !== "completionAttemptId")
		const setClause = keys.map((k) => `${k} = ?`).join(", ")
		const values = keys.map((k) => (record as any)[k])
		const query = `UPDATE completion_attempts SET ${setClause}, version = version + 1, updatedAt = ? WHERE completionAttemptId = ? AND version = ?`
		const result = rawDb.prepare(query).run(...values, Date.now(), record.completionAttemptId, expectedVersion)
		return result.changes > 0
	} catch (error) {
		Logger.error(`[CompletionFunnel] Failed to update completion attempt CAS:`, error)
		throw error
	}
}

export interface PreparedCompletionAttempt {
	kind: "evidence_required" | "proposal_ready" | "blocked" | "rejected" | "terminal"
	completionAttemptId: string
	taskId: string
	generationId: string
	originatingInvocationId: string
	expectedLifecycleRevision: number
	executionIntent?: {
		command: string
	}
	decision?: CompletionDecision
	feedback?: string
	files?: any
	images?: any
	event?: CompletionFunnelEvent
	record?: TaskCompletionRecord
}

export async function prepareCompletionAttempt(
	config: TaskConfig,
	input: {
		result: string
		taskDescription: string
		command?: string
		originatingInvocationId: string
	},
): Promise<PreparedCompletionAttempt> {
	const activeLockContainer = config.taskState.activeLockClaim as LockClaim | { lockClaim?: LockClaim } | undefined
	const activeLockClaim =
		activeLockContainer && "lockClaim" in activeLockContainer
			? activeLockContainer.lockClaim
			: (activeLockContainer as LockClaim | undefined)
	const authorityMode = activeLockClaim?.authorityMode ?? configuredCoordinationAuthorityMode()
	let existingCompletion: TaskCompletionRecord | undefined

	if (authorityMode === "sqlite") {
		existingCompletion = await durableGetTaskCompletion(config.taskId)
		if (existingCompletion && existingCompletion.status !== "succeeded") {
			throw new CoordinationError(
				CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
				`Terminal conflict: task already committed with status '${existingCompletion.status}' (${existingCompletion.decisionId}).`,
				"fail_closed",
			)
		}
	}
	const stateIdentifier = await resolveAuditStateIdentifier(config)
	const evaluatedStateVersion = config.taskState.workspaceStateVersion || 0
	const proposedDecisionId = canonicalDecisionId({
		taskId: config.taskId,
		evaluatedStateVersion,
		checkpoint: stateIdentifier,
		outcome: "succeeded",
		decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
	})

	if (existingCompletion) {
		const decision: CompletionDecision = {
			status: "approved",
			code: "COMPLETION_APPROVED",
			nextTransition: "TERMINAL_SUCCESS",
			stateVersion: existingCompletion.evaluatedStateVersion,
			decisionId: existingCompletion.decisionId,
		}
		const terminalDecision: CompletionFunnelDecision = {
			kind: "completed",
			nextAllowedAction: "none",
			forbiddenActions: ["attempt_completion"],
			canonicalInstruction: "Task completion is committed. No completion action remains.",
			reason: "The durable completion record is authoritative; no gate may reopen it.",
			stages: [
				pass("durable_lookup", "Existing successful completion record validated"),
				pass("decision", "Durable terminal completion supersedes every non-terminal projection", true),
			],
			decisionId: existingCompletion.decisionId,
			committedAt: existingCompletion.committedAt,
		}
		const event = decisionToCompletionFunnelEvent(config, terminalDecision, {
			decisionId: existingCompletion.decisionId,
			committedAt: existingCompletion.committedAt,
		})
		await commitCompletionLifecycleFact(config, existingCompletion.decisionId, existingCompletion.committedAt)
		await publishCompletionFunnelEvent(config, event)
		return {
			kind: "terminal",
			completionAttemptId: randomUUID(),
			taskId: config.taskId,
			generationId: existingCompletion.leaseEpoch,
			originatingInvocationId: input.originatingInvocationId,
			expectedLifecycleRevision: 0,
			decision,
			record: existingCompletion,
			event,
		}
	}

	// Check if a rejection record already exists for this decisionId
	if (authorityMode === "sqlite") {
		try {
			const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
			const existingRejection = rawDb
				.prepare("SELECT * FROM task_rejections WHERE decisionId = ?")
				.get(proposedDecisionId) as Record<string, unknown> | undefined
			if (existingRejection) {
				const feedback = (existingRejection.feedback as string) || ""
				const decision: CompletionDecision = {
					status: "blocked_recoverable",
					code: "AUDIT_REQUIRED",
					nextTransition: "RETURN_TO_EXECUTION",
					stateVersion: evaluatedStateVersion,
					decisionId: proposedDecisionId,
				}
				const event: CompletionFunnelEvent = {
					schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
					taskId: config.taskId,
					phase: "decision_rejected",
					kind: "soft_block",
					terminal: false,
					nextAllowedAction: "continue_execution",
					forbiddenActions: ["attempt_completion"],
					canonicalInstruction: "Completion rejected by user. Continue execution.",
					reason: `Idempotent recovery: user feedback: ${feedback}`,
					stages: [],
					graphRevision: getCompletionGraphRevision(config),
					evaluatedAt: existingRejection.committedAt as number,
					decisionId: proposedDecisionId,
				}
				return {
					kind: "rejected",
					completionAttemptId: (existingRejection.completionAttemptId as string) || randomUUID(),
					taskId: config.taskId,
					generationId: (existingRejection.generationId as string) || "",
					originatingInvocationId: input.originatingInvocationId,
					expectedLifecycleRevision: (existingRejection.lifecycleRevision as number) || 0,
					decision,
					feedback,
					event,
				}
			}
		} catch {}
	}

	const evaluation = await evaluateCompletionDecision(
		config,
		input.result,
		input.taskDescription,
		proposedDecisionId,
		evaluatedStateVersion,
	)
	const decision = evaluation.decision
	if (decision.status !== "approved") {
		const event = decisionToCompletionFunnelEvent(config, evaluation.funnelDecision)
		await publishCompletionFunnelEvent(config, event)
		return {
			kind: "blocked",
			completionAttemptId: randomUUID(),
			taskId: config.taskId,
			generationId: "",
			originatingInvocationId: input.originatingInvocationId,
			expectedLifecycleRevision: 0,
			decision,
			event,
		}
	}

	const authority = getTaskLifecycleAuthority(config.taskState)
	const currentLifecycle =
		authority.readProjection(config.taskState) ?? (await authority.restore(config.taskState, config.taskId))
	if (!currentLifecycle) {
		throw new Error("Cannot propose completion without an active lifecycle record.")
	}

	const completionAttemptId = randomUUID()
	const expectedLifecycleRevision = currentLifecycle.lifecycleRevision

	// If command is present, it is evidence_required, otherwise it is proposal_ready.
	const hasCommand = !!input.command?.trim()
	const phase = hasCommand ? "evidence_pending" : "prepared"

	if (authorityMode === "sqlite") {
		const commandDigest = input.command ? createHash("sha256").update(input.command).digest("hex") : null
		await insertCompletionAttempt({
			completionAttemptId,
			taskId: config.taskId,
			generationId: currentLifecycle.generationId,
			originatingInvocationId: input.originatingInvocationId,
			phase,
			evidenceRequestId: hasCommand ? randomUUID() : null,
			evidenceInvocationId: null,
			evidenceExecutionEventId: null,
			commandIntentJson: input.command ? JSON.stringify({ command: input.command }) : null,
			commandDigest,
			expectedLifecycleRevision,
			evaluatedStateVersion,
			proposalEventId: null,
			decisionId: proposedDecisionId,
			version: 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})
	}

	if (hasCommand) {
		return {
			kind: "evidence_required",
			completionAttemptId,
			taskId: config.taskId,
			generationId: currentLifecycle.generationId,
			originatingInvocationId: input.originatingInvocationId,
			expectedLifecycleRevision,
			executionIntent: {
				command: input.command!,
			},
		}
	}
	return {
		kind: "proposal_ready",
		completionAttemptId,
		taskId: config.taskId,
		generationId: currentLifecycle.generationId,
		originatingInvocationId: input.originatingInvocationId,
		expectedLifecycleRevision,
	}
}

export async function continueCompletionAttempt(
	config: TaskConfig,
	input: {
		completionAttemptId: string
		evidenceExecutionEventId?: string
		resultText: string
		taskDescription: string
	},
): Promise<CompletionFunnelAttemptResult> {
	const activeLockContainer = config.taskState.activeLockClaim as LockClaim | { lockClaim?: LockClaim } | undefined
	const activeLockClaim =
		activeLockContainer && "lockClaim" in activeLockContainer
			? activeLockContainer.lockClaim
			: (activeLockContainer as LockClaim | undefined)
	const authorityMode = activeLockClaim?.authorityMode ?? configuredCoordinationAuthorityMode()

	let attempt = await getCompletionAttempt(input.completionAttemptId)
	if (!attempt) {
		throw new Error(`Completion attempt ${input.completionAttemptId} not found.`)
	}

	// 1. Verify and process evidence if requested
	if (attempt.commandIntentJson) {
		if (!input.evidenceExecutionEventId) {
			await updateCompletionAttemptCAS(attempt.version, {
				completionAttemptId: attempt.completionAttemptId,
				phase: "evidence_failed",
			})
			const rejectedEvent: CompletionFunnelEvent = {
				schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
				taskId: config.taskId,
				phase: "decision_rejected",
				kind: "soft_block",
				terminal: false,
				nextAllowedAction: "continue_execution",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: "Completion rejected. Continue execution.",
				reason: "Validation command execution failed or was denied.",
				stages: [],
				graphRevision: getCompletionGraphRevision(config),
				evaluatedAt: Date.now(),
				decisionId: attempt.decisionId || "",
			}
			await publishCompletionFunnelEvent(config, rejectedEvent)
			return {
				kind: "rejected",
				decision: {
					status: "blocked_recoverable",
					code: "AUDIT_REQUIRED",
					nextTransition: "RETURN_TO_EXECUTION",
					stateVersion: attempt.expectedLifecycleRevision,
					decisionId: attempt.decisionId || "",
				},
				feedback: "Validation command execution failed or was denied.",
				event: rejectedEvent,
			}
		}

		// Load execution terminal-event from immutable database to prevent fabricated evidence!
		const eventObj = await loadTerminalExecutionEvent(input.evidenceExecutionEventId)
		if (!eventObj) {
			throw new Error(`Immutable execution event ${input.evidenceExecutionEventId} not found or not terminal.`)
		}
		// Validate event integrity
		if (
			eventObj.taskId !== attempt.taskId ||
			eventObj.taskGeneration !== attempt.generationId ||
			eventObj.invocationId !== attempt.evidenceInvocationId ||
			eventObj.correlation?.completionAttemptId !== attempt.completionAttemptId ||
			eventObj.phase !== "succeeded"
		) {
			await updateCompletionAttemptCAS(attempt.version, {
				completionAttemptId: attempt.completionAttemptId,
				phase: "evidence_failed",
				evidenceExecutionEventId: input.evidenceExecutionEventId,
			})
			const reasonText = `Validation command rejected or failed integrity check. Reason: ${eventObj.reason || "Integrity validation mismatch."}`
			const rejectedEvent: CompletionFunnelEvent = {
				schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
				taskId: config.taskId,
				phase: "decision_rejected",
				kind: "soft_block",
				terminal: false,
				nextAllowedAction: "continue_execution",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: "Completion rejected. Continue execution.",
				reason: reasonText,
				stages: [],
				graphRevision: getCompletionGraphRevision(config),
				evaluatedAt: Date.now(),
				decisionId: attempt.decisionId || "",
			}
			await publishCompletionFunnelEvent(config, rejectedEvent)
			return {
				kind: "rejected",
				decision: {
					status: "blocked_recoverable",
					code: "AUDIT_REQUIRED",
					nextTransition: "RETURN_TO_EXECUTION",
					stateVersion: attempt.expectedLifecycleRevision,
					decisionId: attempt.decisionId || "",
				},
				feedback: reasonText,
				event: rejectedEvent,
			}
		}

		const updated = await updateCompletionAttemptCAS(attempt.version, {
			completionAttemptId: attempt.completionAttemptId,
			phase: "evidence_succeeded",
			evidenceExecutionEventId: input.evidenceExecutionEventId,
		})
		if (updated) {
			attempt = (await getCompletionAttempt(attempt.completionAttemptId))!
		}
	}

	// 2. Perform the lifecycle suspension and proposal
	const authority = getTaskLifecycleAuthority(config.taskState)
	const currentLifecycle =
		authority.readProjection(config.taskState) ?? (await authority.restore(config.taskState, config.taskId))
	if (!currentLifecycle || currentLifecycle.lifecycleRevision !== attempt.expectedLifecycleRevision) {
		throw new Error("Lifecycle generation has changed or revision mismatch.")
	}

	const proposalEventId = randomUUID()

	const updated = await updateCompletionAttemptCAS(attempt.version, {
		completionAttemptId: attempt.completionAttemptId,
		phase: "proposal_pending",
		proposalEventId,
	})
	if (updated) {
		attempt = (await getCompletionAttempt(attempt.completionAttemptId))!
	}

	const suspendResult = await authority.submit(config.taskState, {
		type: "SuspendGeneration",
		intentId: createTaskLifecycleIntentId(),
		taskId: config.taskId,
		generationId: attempt.generationId,
		cause: {
			source: "completion_funnel",
			reason: `awaiting_completion_decision:${attempt.completionAttemptId}`,
			originatingOperationId: attempt.decisionId || "",
		},
	})
	if (suspendResult.kind === "rejected") {
		throw new Error(`Lifecycle suspension rejected (${suspendResult.code}): ${suspendResult.reason}`)
	}

	const evaluation = await evaluateCompletionDecision(
		config,
		input.resultText,
		input.taskDescription,
		attempt.decisionId || "",
		attempt.expectedLifecycleRevision,
	)

	const proposedEvent: CompletionFunnelEvent = {
		schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
		taskId: config.taskId,
		phase: "proposed",
		kind: evaluation.funnelDecision.kind,
		terminal: false,
		nextAllowedAction: "none",
		forbiddenActions: ["attempt_completion"],
		canonicalInstruction: "Completion proposal awaiting user resolution.",
		reason: "Task completion has been proposed and is awaiting user approval.",
		stages: evaluation.funnelDecision.stages,
		graphRevision: getCompletionGraphRevision(config),
		evaluatedAt: Date.now(),
		decisionId: attempt.decisionId || "",
	}
	await publishCompletionFunnelEvent(config, proposedEvent)

	// 3. Ask User
	const { response, text, images, files } = await config.callbacks.ask("completion_result", "", false)

	// Case A: Accepted
	if (response === "yesButtonClicked") {
		const completionMessageTs = await config.callbacks.say(
			"completion_result",
			input.resultText,
			undefined,
			undefined,
			false,
			config.taskState.lastCompletionAudit,
		)
		await config.callbacks.saveCheckpoint(true, completionMessageTs)

		let committedRecord: TaskCompletionRecord | undefined
		try {
			if (authorityMode === "sqlite") {
				let commitClaim = activeLockClaim
				let releaseOwnedCompletionLease = false
				try {
					if (commitClaim && (commitClaim.authorityMode !== "sqlite" || !commitClaim.backends.swarmMutex)) {
						throw new CoordinationError(
							CoordinationErrorCode.AUTHORITY_MODE_MISMATCH,
							"A local-test or non-durable claim cannot terminalize through SQLite authority.",
							"fail_closed",
						)
					}
					if (!commitClaim) {
						const lease = await SwarmMutexService.acquireLease(
							`task-completion:${config.taskId}`,
							config.taskId,
							60_000,
						)
						commitClaim = {
							claimId: `completion:${attempt.decisionId}`,
							resourceKey: lease.resource,
							ownerId: lease.ownerId,
							fencingToken: lease.fencingToken,
							leaseEpoch: lease.leaseEpoch,
							authorityMode: "sqlite",
							acquiredAt: lease.createdAt,
							backends: {
								inProcess: false,
								swarmMutex: true,
								roadmapLease: false,
								fileLock: false,
								broccoliFence: false,
							},
						}
						releaseOwnedCompletionLease = true
					}
					const record: TaskCompletionRecord = {
						taskId: config.taskId,
						decisionId: attempt.decisionId || "",
						status: "succeeded",
						evaluatedStateVersion: attempt.evaluatedStateVersion ?? config.taskState.workspaceStateVersion ?? 0,
						evaluatedCheckpointJson: canonicalCompletionJson({
							checkpoint: await resolveAuditStateIdentifier(config),
						}),
						decisionJson: canonicalCompletionJson({ decision: evaluation.decision, result: input.resultText }),
						ownerId: commitClaim.ownerId,
						leaseEpoch: commitClaim.leaseEpoch,
						fencingToken: commitClaim.fencingToken,
						committedAt: Date.now(),
					}
					const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
					committedRecord = commitTaskCompletionTransaction(rawDb, {
						record,
						resourceKey: commitClaim.resourceKey,
						currentStateVersion: () => config.taskState.workspaceStateVersion || 0,
					}).record
				} finally {
					if (releaseOwnedCompletionLease && commitClaim) {
						await SwarmMutexService.release(
							commitClaim.resourceKey,
							commitClaim.ownerId,
							commitClaim.leaseEpoch,
							commitClaim.fencingToken,
						).catch(() => undefined)
					}
				}
			}

			const finalDecisionId = committedRecord?.decisionId ?? attempt.decisionId ?? ""
			const committedAt = committedRecord?.committedAt ?? Date.now()

			const settleResult = await authority.submit(config.taskState, {
				type: "SettleCompletion",
				intentId: createTaskLifecycleIntentId(),
				taskId: config.taskId,
				generationId: attempt.generationId,
				cause: {
					source: "completion_funnel",
					reason: "CompletionFunnel durably committed the semantic completion fact.",
					originatingOperationId: finalDecisionId,
					authoritativeAt: committedAt,
				},
			})
			if (settleResult.kind === "rejected") {
				throw new Error(`Lifecycle settlement rejected (${settleResult.code}): ${settleResult.reason}`)
			}

			await updateCompletionAttemptCAS(attempt.version, {
				completionAttemptId: attempt.completionAttemptId,
				phase: "completed",
			})

			const acceptedEvent: CompletionFunnelEvent = {
				schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
				taskId: config.taskId,
				phase: "completed",
				kind: "completed",
				terminal: true,
				nextAllowedAction: "none",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: "Task completion is committed. No completion action remains.",
				reason: "The authoritative completion transaction committed successfully.",
				stages: [...evaluation.funnelDecision.stages, pass("terminal_commit", "Durable completion committed", true)],
				graphRevision: getCompletionGraphRevision(config),
				evaluatedAt: Date.now(),
				decisionId: finalDecisionId,
				committedAt,
			}
			await publishCompletionFunnelEvent(config, acceptedEvent)
			return {
				kind: "terminal",
				decision: { ...evaluation.decision, decisionId: finalDecisionId },
				record: committedRecord,
				event: acceptedEvent,
			}
		} catch (error) {
			Logger.error("[CompletionFunnel] Acceptance settlement failed:", error)
			await updateCompletionAttemptCAS(attempt.version, {
				completionAttemptId: attempt.completionAttemptId,
				phase: "settlement_failed",
			})
			const failedEvent: CompletionFunnelEvent = {
				schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
				taskId: config.taskId,
				phase: "settlement_failed",
				kind: "soft_block",
				terminal: false,
				nextAllowedAction: "continue_execution",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: `Settlement failed: ${String(error)}`,
				reason: `Completion settlement error: ${String(error)}`,
				stages: evaluation.funnelDecision.stages,
				graphRevision: getCompletionGraphRevision(config),
				evaluatedAt: Date.now(),
				decisionId: attempt.decisionId || "",
			}
			await publishCompletionFunnelEvent(config, failedEvent)
			return { kind: "settlement_failed", decision: evaluation.decision, event: failedEvent }
		}
	}

	// Case B: Rejected
	const feedbackText = text ?? ""
	try {
		if (authorityMode === "sqlite") {
			const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
			rawDb
				.prepare(
					`INSERT OR IGNORE INTO task_rejections (
						decisionId, taskId, generationId, completionAttemptId, proposalEventId,
						lifecycleRevision, feedback, filesJson, imagesJson, committedAt
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					attempt.decisionId || "",
					config.taskId,
					attempt.generationId,
					attempt.completionAttemptId,
					proposalEventId,
					suspendResult.record.lifecycleRevision,
					feedbackText,
					files ? JSON.stringify(files) : null,
					images ? JSON.stringify(images) : null,
					Date.now(),
				)
		}

		const activateResult = await authority.submit(config.taskState, {
			type: "ReactivateAfterCompletionRejection",
			intentId: createTaskLifecycleIntentId(),
			taskId: config.taskId,
			generationId: attempt.generationId,
			expectedRevision: suspendResult.record.lifecycleRevision,
			completionAttemptId: attempt.completionAttemptId,
			decisionId: attempt.decisionId || "",
			cause: {
				source: "completion_funnel",
				reason: "The user rejected the completion attempt and provided feedback.",
				originatingOperationId: attempt.decisionId || "",
			},
		})
		if (activateResult.kind === "rejected") {
			throw new Error(`Lifecycle reactivation rejected (${activateResult.code}): ${activateResult.reason}`)
		}

		await updateCompletionAttemptCAS(attempt.version, {
			completionAttemptId: attempt.completionAttemptId,
			phase: "decision_rejected",
		})

		const rejectedEvent: CompletionFunnelEvent = {
			schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
			taskId: config.taskId,
			phase: "decision_rejected",
			kind: "soft_block",
			terminal: false,
			nextAllowedAction: "continue_execution",
			forbiddenActions: ["attempt_completion"],
			canonicalInstruction: "Completion rejected by user. Continue execution.",
			reason: `User feedback: ${feedbackText}`,
			stages: evaluation.funnelDecision.stages,
			graphRevision: getCompletionGraphRevision(config),
			evaluatedAt: Date.now(),
			decisionId: attempt.decisionId || "",
		}
		await publishCompletionFunnelEvent(config, rejectedEvent)
		return { kind: "rejected", decision: evaluation.decision, feedback: feedbackText, files, images, event: rejectedEvent }
	} catch (error) {
		Logger.error("[CompletionFunnel] Rejection processing failed:", error)
		throw error
	}
}

export type CompletionFunnelAttemptResult =
	| {
			kind: "terminal"
			decision: CompletionDecision
			record?: TaskCompletionRecord
			event: CompletionFunnelEvent
	  }
	| { kind: "blocked"; decision: CompletionDecision; event: CompletionFunnelEvent }
	| {
			kind: "rejected"
			decision: CompletionDecision
			feedback: string
			files?: string[]
			images?: string[]
			event: CompletionFunnelEvent
	  }
	| { kind: "settlement_failed"; decision: CompletionDecision; event: CompletionFunnelEvent }

export async function loadTerminalExecutionEvent(eventId: string): Promise<ExecutionFunnelEvent | undefined> {
	try {
		const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
		const eventRow = rawDb.prepare("SELECT data FROM audit_events WHERE id = ?").get(eventId) as { data: string } | undefined
		if (!eventRow) return undefined
		const eventObj = JSON.parse(eventRow.data) as ExecutionFunnelEvent
		if (eventObj.terminal) return eventObj
		return undefined
	} catch (error) {
		Logger.error(`[CompletionFunnel] Failed to load terminal event ${eventId}:`, error)
		return undefined
	}
}
