/**
 * CompletionLifecycleDecisionEngine — the single deterministic authority for
 * all completion/finalization eligibility decisions.
 *
 * Receives an immutable input snapshot and returns one canonical decision.
 * No handler, utility, gate evaluator, or pipeline stage may independently
 * decide completion eligibility — they call this engine.
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
 *     → evaluate engineering verification (latch state)
 *     → evaluate finalization routing (explicit, not emergent)
 *     → return one canonical decision with full trace
 *
 * Industry patterns mirrored:
 * - Finite state machine for lifecycle transitions
 * - Circuit breaker / half-open probe (Hystrix, Envoy)
 * - CDN cache validation: all validity dimensions must match (AND, not OR)
 * - Idempotency-key duplicate suppression
 * - Single policy engine: handlers collect, engine decides, handlers execute
 * - Structured decision traces (workflow engines, distributed systems debuggers)
 * - Fail-closed only for known active gates; fail-open for unknown/retired gates
 */

import { COMPLETION_AUDIT_CACHE_TTL_MS, MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import type {
	AuditValidityEvaluation,
	CompletionLifecycleDecision,
	CompletionLifecycleSnapshot,
	DecisionStage,
} from "./CompletionLifecycleTypes"
import { isGateActive, isGateKnown } from "./gateRegistry"

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
export function evaluateAuditValidity(snapshot: CompletionLifecycleSnapshot): AuditValidityEvaluation {
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
export function hasWorkspaceProgress(snapshot: CompletionLifecycleSnapshot): boolean {
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
export function isDuplicateAttempt(snapshot: CompletionLifecycleSnapshot): boolean {
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
 * - Tripped + engineering NOT verified + workspace changed → "half_open"
 * - Tripped + engineering verified → "tripped" (use run_finalization)
 * - Tripped + workspace unchanged → "tripped"
 *
 * Half-open is deterministic: exactly one probe is allowed per checkpoint
 * (tracked via lastProbeCheckpointHash).
 */
export function evaluateCircuitBreaker(snapshot: CompletionLifecycleSnapshot): {
	state: "closed" | "tripped" | "half_open"
	stages: DecisionStage[]
} {
	const stages: DecisionStage[] = []

	if (snapshot.blockCount < MAX_COMPLETION_GATE_BLOCK_COUNT) {
		stages.push(pass("circuit_breaker", `Closed (${snapshot.blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT} blocks)`))
		return { state: "closed", stages }
	}

	stages.push(fail("circuit_breaker", `Tripped (${snapshot.blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT} blocks)`))

	// Engineering verified → stay tripped, route to finalization
	if (snapshot.engineeringVerifiedAt !== undefined) {
		stages.push(pass("circuit_breaker.routing", "Engineering verified — route to finalization, stay tripped"))
		return { state: "tripped", stages }
	}

	// Not verified — check if workspace changed for half-open probe
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

// ─── Engineering Verification ─────────────────────────────────────────────────

export function isEngineeringVerified(snapshot: CompletionLifecycleSnapshot): boolean {
	return snapshot.engineeringVerifiedAt !== undefined
}

// ─── Finalization Routing ─────────────────────────────────────────────────────

/**
 * Evaluate whether the task should be routed to finalization.
 *
 * Finalization routing is EXPLICIT, not emergent from failed completion retries:
 * - Engineering verified + finalization not yet completed → route to finalization
 * - Engineering verified + finalization completed → route to seal
 * - Engineering not verified → do not route (completion lane)
 */
export function shouldRouteToFinalization(snapshot: CompletionLifecycleSnapshot): boolean {
	if (!isEngineeringVerified(snapshot)) {
		return false
	}
	// Already completed finalization — route to seal (still finalization lane)
	if (snapshot.finalizationPhase === "completed" || snapshot.finalizationEvidenceStatus === "passed") {
		return true
	}
	// Engineering verified but finalization not started — route to finalization
	return true
}

// ─── The Engine ───────────────────────────────────────────────────────────────

/**
 * The single deterministic completion lifecycle decision engine.
 *
 * Evaluate an immutable snapshot and return one canonical decision.
 * Every decision emits a structured trace showing each evaluated stage,
 * input state, result, and reason.
 *
 * The engine is pure — no side effects, no mutable state reads.
 * Callers normalize task state into a snapshot, the engine decides,
 * callers execute the decision.
 */
export const CompletionLifecycleDecisionEngine = {
	/**
	 * Evaluate a completion lifecycle snapshot and return one canonical decision.
	 *
	 * Pipeline (each stage adds to the trace):
	 *   1. Normalize inputs
	 *   2. Validate active registry
	 *   3. Evaluate audit validity (strict AND)
	 *   4. Evaluate workspace progress
	 *   5. Evaluate duplicate attempt
	 *   6. Evaluate circuit breaker
	 *   7. Evaluate half-open probe eligibility
	 *   8. Evaluate engineering verification
	 *   9. Evaluate finalization routing
	 *  10. Return one canonical decision
	 */
	evaluate(snapshot: CompletionLifecycleSnapshot): CompletionLifecycleDecision {
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

		// ── Stage 8 (early): Evaluate engineering verification ──
		// This is evaluated early because it determines the lane (completion vs finalization)
		const engineeringVerified = isEngineeringVerified(snapshot)
		stages.push(
			engineeringVerified
				? pass("engineering", `Verified at ${snapshot.engineeringVerifiedAt}`)
				: na("engineering", "Not yet verified — completion lane"),
		)

		// ── Stage 9 (early): Evaluate finalization routing ──
		// If engineering is verified, route to finalization explicitly.
		// This is checked before circuit breaker / duplicate / workspace —
		// a verified task should never be blocked by completion-side gates.
		if (shouldRouteToFinalization(snapshot)) {
			const finalizationComplete =
				snapshot.finalizationPhase === "completed" || snapshot.finalizationEvidenceStatus === "passed"
			stages.push(
				pass(
					"finalization_routing",
					finalizationComplete
						? "Engineering verified + finalization complete — route to seal"
						: "Engineering verified — route to finalization",
					true,
				),
			)
			// Still evaluate remaining stages for trace completeness, but they're non-decisive
			const auditValidity = evaluateAuditValidity(snapshot)
			stages.push(...auditValidity.stages.map((s) => ({ ...s, decisive: false })))

			return {
				kind: "route_to_finalization" as const,
				nextAllowedAction: "run_finalization" as const,
				forbiddenActions: ["attempt_completion"] as const,
				canonicalInstruction: finalizationComplete
					? "Call run_finalization with seal=true now. Do not call attempt_completion."
					: "Call run_finalization now. Do not call attempt_completion.",
				reason: finalizationComplete
					? "Engineering verified and finalization complete. Call run_finalization with seal=true to emit the sealed receipt and end the session."
					: "Engineering verified. Call run_finalization to update documentation and stamp the ledger in this session.",
				stages,
			}
		}

		// ── Stage 3: Evaluate audit validity ──
		const auditValidity = evaluateAuditValidity(snapshot)
		stages.push(...auditValidity.stages)

		// ── Stage 6: Evaluate circuit breaker ──
		const circuitBreaker = evaluateCircuitBreaker(snapshot)
		stages.push(...circuitBreaker.stages)

		// Circuit breaker tripped (not half-open) → hard block
		if (circuitBreaker.state === "tripped") {
			stages.push(fail("decision", "Circuit breaker tripped — hard block", true))
			return {
				kind: "hard_block" as const,
				nextAllowedAction: "stop_and_report" as const,
				forbiddenActions: ["attempt_completion", "run_finalization"] as const,
				canonicalInstruction:
					"Stop calling attempt_completion. Make workspace changes for a probe attempt, or present results via act_mode_respond.",
				reason:
					`Maximum completion gate retries (${MAX_COMPLETION_GATE_BLOCK_COUNT}) exceeded. ` +
					"Make substantive workspace changes (checkpoint hash must change) for a probe attempt, " +
					"or use act_mode_respond to present results.",
				playbook: [
					"Stop calling attempt_completion — further calls will fail unless workspace changes.",
					"Make substantive code changes (checkpoint hash must change) — circuit breaker opens for one probe.",
					"If the probe passes, engineering is verified and run_finalization becomes available.",
					"If violations cannot be fixed, present results via act_mode_respond.",
				],
				stages,
			}
		}

		// Circuit breaker half-open → allow probe
		if (circuitBreaker.state === "half_open") {
			stages.push(pass("decision", "Circuit breaker half-open — probe allowed", true))
			return {
				kind: "allow_probe" as const,
				nextAllowedAction: "attempt_completion" as const,
				forbiddenActions: [] as const,
				canonicalInstruction:
					"Call attempt_completion now. This is a half-open probe — one attempt allowed for this checkpoint.",
				reason:
					"Circuit breaker half-open: workspace changed since last block. " +
					"One probe attempt is allowed for this checkpoint. If it passes, engineering is verified.",
				stages,
			}
		}

		// ── Stage 4: Evaluate workspace progress ──
		// Only applies when there are prior blocks and engineering not verified
		if (snapshot.blockCount > 0 && !engineeringVerified) {
			const workspaceChanged = hasWorkspaceProgress(snapshot)
			if (!workspaceChanged && snapshot.lastGateBlockCheckpointHash) {
				stages.push(
					fail("workspace_progress", "Workspace unchanged since last gate block — rewording result won't help", true),
				)
				return {
					kind: "soft_block" as const,
					nextAllowedAction: "modify_workspace" as const,
					forbiddenActions: ["attempt_completion", "run_finalization"] as const,
					canonicalInstruction:
						"Do not call attempt_completion. Modify the workspace (code changes required), then retry.",
					reason:
						"Completion blocked: the workspace hasn't changed since the last gate block. " +
						"Rewording the result summary won't change the audit outcome. " +
						"Make substantive fixes to the code (checkpoint hash must change), then retry.",
					playbook: [
						"Make actual code changes — rewording the result summary won't fix audit violations.",
						"Verify the checkpoint hash changed (via git status or a test run) before retrying.",
						"If violations can't be fixed, summarize progress and use run_finalization after engineering verification.",
					],
					stages,
				}
			}
			stages.push(pass("workspace_progress", "Workspace changed since last gate block"))
		} else {
			stages.push(na("workspace_progress", "No prior blocks or engineering verified — skipping"))
		}

		// ── Stage 5: Evaluate duplicate attempt ──
		if (isDuplicateAttempt(snapshot)) {
			stages.push(fail("duplicate_check", "Same result fingerprint AND same workspace checkpoint — duplicate", true))
			return {
				kind: "soft_block" as const,
				nextAllowedAction: "modify_workspace" as const,
				forbiddenActions: ["attempt_completion", "run_finalization"] as const,
				canonicalInstruction:
					"Do not call attempt_completion. Modify the workspace (code changes required), then retry with an updated result.",
				reason:
					"Duplicate completion submission: the same result was re-submitted after a gate block with no workspace changes. " +
					"Fix violations in the workspace and update your result before retrying.",
				playbook: [
					"Make substantive fixes in the workspace — do not retry the same summary.",
					"Verify changes with git status or tests before retrying.",
					"If violations can't be fixed, summarize progress and use run_finalization after engineering verification.",
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

		stages.push(
			pass(
				"decision",
				canFastPath ? "All stages passed — allow attempt (fast path eligible)" : "All stages passed — allow attempt",
				true,
			),
		)

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
export function buildSnapshot(input: CompletionLifecycleSnapshot): CompletionLifecycleSnapshot {
	return Object.freeze({ ...input }) as CompletionLifecycleSnapshot
}
