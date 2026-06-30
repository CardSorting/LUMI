/**
 * CompletionLifecycleDecisionEngine — Types
 *
 * The single authority for all completion/finalization eligibility decisions.
 * No handler, utility, gate evaluator, or pipeline stage may independently
 * decide completion eligibility — they collect context, the engine decides,
 * handlers execute.
 *
 * Design mirrors:
 * - Finite state machine design for lifecycle transitions
 * - Circuit breaker / half-open probe patterns (Hystrix, Envoy)
 * - CDN cache validation semantics (all dimensions must match, not OR)
 * - Idempotency-key style duplicate suppression
 * - Single policy engine pattern: handlers collect, engine decides, handlers execute
 * - Structured decision traces (workflow engines, distributed systems debuggers)
 */

import type { AuditGateDecision } from "@shared/audit/auditGateReport"
import type { GateLifecycleState } from "@shared/completion/completionLifecycle"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"

// ─── Registry Types ───────────────────────────────────────────────────────────

/**
 * A gate registered with the completion lifecycle system.
 * Gates that are not registered, or registered as `retired`, are treated as
 * non-participating — they neither block nor contribute to audit validity.
 *
 * Mirrors service registry patterns (Consul, etcd): services that deregister
 * are non-participating, not blocking.
 */
export interface RegisteredGate {
	/** Unique gate identifier (e.g. "audit", "roadmap", "focus_chain"). */
	id: string
	/** Active gates participate in completion decisions. Retired gates do not. */
	status: "active" | "retired"
	/** Optional version for forward compatibility. */
	version?: number
}

/**
 * The active lifecycle registry — all gates currently known to the system.
 * Gates not in this registry are unknown and treated as non-participating.
 */
export type GateRegistry = ReadonlyMap<string, RegisteredGate>

/**
 * The active lifecycle state registry — tracks which lifecycle states
 * are currently valid for the task.
 */
export interface LifecycleRegistry {
	gates: GateRegistry
}

// ─── Snapshot Input ───────────────────────────────────────────────────────────

/**
 * Immutable input snapshot for the decision engine.
 * Every field the engine needs to make a decision, frozen at evaluation time.
 *
 * The engine never reads from mutable task state directly — callers must
 * normalize task state into this snapshot before calling evaluate().
 */
export interface CompletionLifecycleSnapshot {
	// ── Identity ──
	readonly taskId: string
	readonly sessionId: string | undefined

	// ── Workspace state ──
	readonly checkpointHash: string | undefined
	readonly graphRevision: number

	// ── Registries ──
	readonly registry: LifecycleRegistry

	// ── Engineering verification ──
	readonly engineeringVerifiedAt: number | undefined

	// ── Finalization state ──
	readonly finalizationPhase: "ready" | "running" | "completed" | "failed" | undefined
	readonly finalizationEvidenceStatus: "passed" | "failed" | undefined

	// ── Completion attempt state ──
	readonly resultFingerprint: string | undefined
	readonly lastCompletionAttemptAt: number | undefined
	readonly lastCompletionAttemptGraphRevision: number | undefined

	// ── Gate block state ──
	readonly blockCount: number
	readonly lastGateBlockCheckpointHash: string | undefined
	readonly lastBlockedResultFingerprint: string | undefined

	// ── Audit state ──
	readonly auditMetadata: TaskAuditMetadata | undefined
	readonly auditCacheKey: string | undefined
	readonly lastAuditCacheKey: string | undefined
	readonly auditCachedAt: number | undefined
	readonly auditGraphRevision: number | undefined
	readonly auditGateEnabled: boolean
	readonly auditGateDecision: AuditGateDecision | undefined

	// ── Lifecycle decision cache ──
	readonly cachedLifecycleState: GateLifecycleState | undefined
	readonly cachedLifecycleDecisionEvaluatedAt: number | undefined

	// ── Probe tracking ──
	/**
	 * The checkpoint hash that was used for the last half-open probe attempt.
	 * If this matches the current checkpoint hash, a second probe is blocked.
	 */
	readonly lastProbeCheckpointHash: string | undefined

	// ── Evaluation time ──
	readonly now: number
}

// ─── Decision Output ──────────────────────────────────────────────────────────

export type CompletionDecisionKind = "allow_attempt" | "allow_probe" | "route_to_finalization" | "soft_block" | "hard_block"

/**
 * The binding action contract — the only tool action the agent is permitted
 * to execute next, and the actions explicitly forbidden by this decision.
 *
 * The agent does not interpret lifecycle state. It receives a command.
 * The decision engine determines truth. The action guard enforces truth.
 * The agent only executes the permitted next action.
 */
export type CompletionNextAction = "attempt_completion" | "run_finalization" | "modify_workspace" | "stop_and_report" | "none"

/**
 * A single stage in the decision trace — shows what was evaluated,
 * what was found, and why it matters.
 */
export interface DecisionStage {
	/** Stage name (e.g. "audit_validity", "circuit_breaker", "duplicate_check"). */
	stage: string
	/** Result of this stage (e.g. "passed", "failed", "skipped", "not_applicable"). */
	result: "passed" | "failed" | "skipped" | "not_applicable"
	/** Human-readable explanation of the stage result. */
	reason: string
	/** Whether this stage contributed to the final decision. */
	decisive: boolean
}

/**
 * The canonical completion lifecycle decision.
 * One answer to: "Is this task allowed to complete, blocked, retry-locked,
 * routed to finalization, or eligible for a recovery probe?"
 *
 * Every decision carries a binding action contract:
 * - `nextAllowedAction`: the ONE tool action the agent may execute next
 * - `forbiddenActions`: tool actions that MUST be rejected by the guard
 * - `canonicalInstruction`: one-line imperative command (no prose interpretation)
 *
 * The agent does not interpret lifecycle state. It receives a command.
 */
export type CompletionLifecycleDecision = {
	kind: CompletionDecisionKind
	nextAllowedAction: CompletionNextAction
	forbiddenActions: CompletionNextAction[]
	canonicalInstruction: string
	reason: string
	stages: DecisionStage[]
} & (
	| { kind: "allow_attempt" }
	| { kind: "allow_probe" }
	| { kind: "route_to_finalization" }
	| { kind: "soft_block"; playbook: string[] }
	| { kind: "hard_block"; playbook: string[] }
)

// ─── Audit Validity ───────────────────────────────────────────────────────────

export type AuditValidityResult = "valid" | "invalidated" | "stale_pending_reconciliation" | "not_evaluated"

/**
 * Audit validity computed by the engine — strict AND validation.
 * All dimensions must match for "valid". Any mismatch → "invalidated".
 *
 * Mirrors CDN cache validation: ETag (cache key) + Last-Modified (graph
 * revision) + Cache-Control max-age (TTL) must ALL match.
 */
export interface AuditValidityEvaluation {
	result: AuditValidityResult
	stages: DecisionStage[]
	/** True if the audit gate that produced this audit is in the active registry. */
	gateActive: boolean
}
