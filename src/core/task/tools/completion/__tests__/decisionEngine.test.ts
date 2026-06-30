import { beforeEach, describe, it } from "mocha"
import "should"
import { COMPLETION_AUDIT_CACHE_TTL_MS, MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	CompletionLifecycleDecisionEngine,
	evaluateAuditValidity,
	isDuplicateAttempt,
} from "../CompletionLifecycleDecisionEngine"
import type { CompletionLifecycleSnapshot } from "../CompletionLifecycleTypes"
import { buildCompletionSnapshot, evaluateCompletionLifecycle } from "../completionSnapshotBuilder"
import { buildGateRegistry, DEFAULT_GATE_REGISTRY } from "../gateRegistry"

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<CompletionLifecycleSnapshot> = {}): CompletionLifecycleSnapshot {
	return {
		taskId: "test-task",
		sessionId: "test-session",
		checkpointHash: "chk-1",
		graphRevision: 1,
		registry: { gates: DEFAULT_GATE_REGISTRY },
		engineeringVerifiedAt: undefined,
		finalizationPhase: undefined,
		finalizationEvidenceStatus: undefined,
		resultFingerprint: undefined,
		lastCompletionAttemptAt: undefined,
		lastCompletionAttemptGraphRevision: undefined,
		blockCount: 0,
		lastGateBlockCheckpointHash: undefined,
		lastBlockedResultFingerprint: undefined,
		auditMetadata: undefined,
		auditCacheKey: undefined,
		lastAuditCacheKey: undefined,
		auditCachedAt: undefined,
		auditGraphRevision: undefined,
		auditGateEnabled: false,
		auditGateDecision: undefined,
		cachedLifecycleState: undefined,
		cachedLifecycleDecisionEvaluatedAt: undefined,
		lastProbeCheckpointHash: undefined,
		now: Date.now(),
		...overrides,
	}
}

function configWithState(taskState: TaskState, messages: Array<{ lastCheckpointHash?: string }> = []): TaskConfig {
	return {
		taskState,
		focusChainSettings: { enabled: false },
		messageState: {
			getDietCodeMessages: () => messages,
		},
	} as unknown as TaskConfig
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CompletionLifecycleDecisionEngine — deterministic completion authority", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("audit validity — strict AND validation", () => {
		it("rejects stale audit cache when graph revision differs", () => {
			const snapshot = makeSnapshot({
				auditMetadata: { hardening_score: 90 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now(),
				auditGraphRevision: 1,
				graphRevision: 2, // Mismatch!
				auditGateEnabled: true,
			})
			const result = evaluateAuditValidity(snapshot)
			result.result.should.equal("invalidated")
			result.stages.should.containDeep([{ stage: "audit_validity.graph_revision", result: "failed" }])
		})

		it("rejects expired audit cache even if graph revision matches", () => {
			const snapshot = makeSnapshot({
				auditMetadata: { hardening_score: 90 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now() - COMPLETION_AUDIT_CACHE_TTL_MS - 1000, // Expired
				auditGraphRevision: 1,
				graphRevision: 1, // Matches
				auditGateEnabled: true,
			})
			const result = evaluateAuditValidity(snapshot)
			result.result.should.equal("stale_pending_reconciliation")
			result.stages.should.containDeep([{ stage: "audit_validity.ttl", result: "failed" }])
		})

		it("rejects audit when cache key differs", () => {
			const snapshot = makeSnapshot({
				auditMetadata: { hardening_score: 90 } as never,
				auditCacheKey: "key-new",
				lastAuditCacheKey: "key-old", // Mismatch!
				auditCachedAt: Date.now(),
				auditGraphRevision: 1,
				graphRevision: 1,
				auditGateEnabled: true,
			})
			const result = evaluateAuditValidity(snapshot)
			result.result.should.equal("invalidated")
			result.stages.should.containDeep([{ stage: "audit_validity.cache_key", result: "failed" }])
		})

		it("returns valid when all four dimensions match", () => {
			const snapshot = makeSnapshot({
				auditMetadata: { hardening_score: 90 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now(),
				auditGraphRevision: 1,
				graphRevision: 1,
				auditGateEnabled: true,
			})
			const result = evaluateAuditValidity(snapshot)
			result.result.should.equal("valid")
			result.gateActive.should.be.true()
		})
	})

	describe("unknown and retired audit gates — non-participating", () => {
		it("ignores unknown audit gate instead of blocking", () => {
			const emptyRegistry = buildGateRegistry([])
			const snapshot = makeSnapshot({
				registry: { gates: emptyRegistry },
				auditMetadata: { hardening_score: 90 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now(),
				auditGraphRevision: 1,
				graphRevision: 1,
				auditGateEnabled: true,
			})
			const result = evaluateAuditValidity(snapshot)
			// Unknown gate → not_evaluated (non-participating), not invalidated
			result.result.should.equal("not_evaluated")
			result.gateActive.should.be.false()
		})

		it("ignores retired audit gate instead of blocking", () => {
			const retiredRegistry = buildGateRegistry([{ id: "audit", status: "retired" }])
			const snapshot = makeSnapshot({
				registry: { gates: retiredRegistry },
				auditMetadata: { hardening_score: 90 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now(),
				auditGraphRevision: 1,
				graphRevision: 1,
				auditGateEnabled: true,
			})
			const result = evaluateAuditValidity(snapshot)
			result.result.should.equal("not_evaluated")
			result.gateActive.should.be.false()
		})
	})

	describe("workspace-unchanged retry soft-blocks", () => {
		it("soft-blocks when workspace unchanged since last gate block", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1", // Same!
				engineeringVerifiedAt: undefined,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("soft_block")
			decision.stages.should.containDeep([{ stage: "workspace_progress", result: "failed" }])
		})

		it("soft-block does not increment circuit breaker (is not a hard block)", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
				engineeringVerifiedAt: undefined,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.not.equal("hard_block")
			// blockCount in snapshot is still 2, not incremented
			decision.kind.should.equal("soft_block")
		})

		it("reworded completion cannot bypass unchanged checkpoint", () => {
			// Same checkpoint hash but different result fingerprint
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1", // Same workspace
				resultFingerprint: "new-fingerprint", // Different result text
				lastBlockedResultFingerprint: "old-fingerprint",
				engineeringVerifiedAt: undefined,
			})
			// Even though result changed, workspace unchanged → soft block
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("soft_block")
			// Duplicate check should pass (different fingerprint), but workspace progress fails
			decision.stages.should.containDeep([{ stage: "workspace_progress", result: "failed" }])
		})
	})

	describe("duplicate detection — fingerprint + workspace hash", () => {
		it("is duplicate when same fingerprint AND same workspace checkpoint", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				resultFingerprint: "fp-1",
				lastBlockedResultFingerprint: "fp-1",
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1", // Same
			})
			isDuplicateAttempt(snapshot).should.be.true()
		})

		it("is not duplicate when result fingerprint differs", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				resultFingerprint: "fp-new",
				lastBlockedResultFingerprint: "fp-old",
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			isDuplicateAttempt(snapshot).should.be.false()
		})

		it("is not duplicate when workspace checkpoint changed", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				resultFingerprint: "fp-1",
				lastBlockedResultFingerprint: "fp-1",
				lastGateBlockCheckpointHash: "chk-old",
				checkpointHash: "chk-new", // Changed
			})
			isDuplicateAttempt(snapshot).should.be.false()
		})
	})

	describe("verified engineering routes to finalization", () => {
		it("routes to finalization when engineering is verified", () => {
			const snapshot = makeSnapshot({
				engineeringVerifiedAt: Date.now(),
				blockCount: 0,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("route_to_finalization")
			decision.reason.should.containEql("run_finalization")
		})

		it("routes to seal when engineering verified and finalization complete", () => {
			const snapshot = makeSnapshot({
				engineeringVerifiedAt: Date.now(),
				finalizationPhase: "completed",
				finalizationEvidenceStatus: "passed",
				blockCount: 0,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("route_to_finalization")
			decision.reason.should.containEql("seal")
		})
	})

	describe("unverified engineering with changed workspace can attempt", () => {
		it("allows attempt when not verified, workspace changed, no blocks", () => {
			const snapshot = makeSnapshot({
				engineeringVerifiedAt: undefined,
				checkpointHash: "chk-new",
				lastGateBlockCheckpointHash: "chk-old",
				blockCount: 2,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("allow_attempt")
		})
	})

	describe("circuit breaker — tripped blocks unchanged workspace", () => {
		it("tripped circuit breaker hard-blocks when workspace unchanged", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1", // Unchanged
				engineeringVerifiedAt: undefined,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("hard_block")
		})
	})

	describe("circuit breaker — half-open probe after workspace change", () => {
		it("allows exactly one half-open probe after workspace change", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-old",
				checkpointHash: "chk-new", // Changed!
				engineeringVerifiedAt: undefined,
				lastProbeCheckpointHash: undefined, // No prior probe
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("allow_probe")
		})

		it("blocks second probe on same checkpoint", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-old",
				checkpointHash: "chk-new", // Changed
				engineeringVerifiedAt: undefined,
				lastProbeCheckpointHash: "chk-new", // Already probed this checkpoint!
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("hard_block")
			// Trace should show probe was rejected
			decision.stages.should.containDeep([{ stage: "circuit_breaker.probe", result: "failed" }])
		})

		it("stays tripped when engineering is verified (use finalization)", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-old",
				checkpointHash: "chk-new",
				engineeringVerifiedAt: Date.now(), // Verified!
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			// Verified → routes to finalization, not probe
			decision.kind.should.equal("route_to_finalization")
		})
	})

	describe("fast-path and slow-path return identical decisions for same snapshot", () => {
		it("returns same decision kind regardless of entry point", () => {
			// Build a snapshot that would be "allow_attempt"
			const snapshot = makeSnapshot({
				blockCount: 0,
				engineeringVerifiedAt: undefined,
				auditGateEnabled: false,
			})

			// Direct engine evaluation (fast-path)
			const directDecision = CompletionLifecycleDecisionEngine.evaluate(snapshot)

			// Via adapter (slow-path uses the same engine)
			const config = configWithState(taskState)
			const adapterDecision = evaluateCompletionLifecycle(config)

			// Both should be "allow_attempt" for the same state
			directDecision.kind.should.equal(adapterDecision.kind)
		})
	})

	describe("finalization routing is explicit and deterministic", () => {
		it("does not route to finalization when engineering is not verified", () => {
			const snapshot = makeSnapshot({
				engineeringVerifiedAt: undefined,
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.not.equal("route_to_finalization")
		})

		it("routes to finalization deterministically when engineering verified", () => {
			const snapshot = makeSnapshot({
				engineeringVerifiedAt: Date.now(),
				blockCount: 0,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("route_to_finalization")
			// Trace must show the finalization_routing stage as decisive
			const routingStage = decision.stages.find((s) => s.stage === "finalization_routing")
			should.exist(routingStage)
			routingStage?.decisive.should.be.true()
		})
	})

	describe("no decision depends on stale cache data alone", () => {
		it("stale audit (TTL expired) does not produce allow_attempt via fast-path", () => {
			const snapshot = makeSnapshot({
				auditMetadata: { hardening_score: 95 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now() - COMPLETION_AUDIT_CACHE_TTL_MS - 1000, // Expired
				auditGraphRevision: 1,
				graphRevision: 1,
				auditGateEnabled: true,
				blockCount: 0,
				engineeringVerifiedAt: undefined,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			// Even with matching cache key and graph revision, the expired TTL
			// means the audit is stale.  The decision should NOT be a fast-path
			// allow (it should be allow_attempt but NOT fast-path eligible).
			decision.kind.should.equal("allow_attempt")
			// Must NOT mention fast path
			const decisionStage = decision.stages.find((s) => s.stage === "decision")
			decisionStage?.reason.should.not.containEql("fast path eligible")
		})

		it("invalidated audit (graph revision mismatch) does not produce allow_attempt via fast-path", () => {
			const snapshot = makeSnapshot({
				auditMetadata: { hardening_score: 95 } as never,
				auditCacheKey: "key-1",
				lastAuditCacheKey: "key-1",
				auditCachedAt: Date.now(),
				auditGraphRevision: 1,
				graphRevision: 2, // Mismatch!
				auditGateEnabled: true,
				blockCount: 0,
				engineeringVerifiedAt: undefined,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("allow_attempt")
			// Must NOT mention fast path
			const decisionStage = decision.stages.find((s) => s.stage === "decision")
			decisionStage?.reason.should.not.containEql("fast path eligible")
		})
	})

	describe("decision trace completeness", () => {
		it("every decision includes a non-empty stages array", () => {
			const cases = [
				makeSnapshot({ blockCount: 0 }),
				makeSnapshot({
					blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
					lastGateBlockCheckpointHash: "chk-1",
					checkpointHash: "chk-1",
				}),
				makeSnapshot({ engineeringVerifiedAt: Date.now() }),
				makeSnapshot({ blockCount: 2, lastGateBlockCheckpointHash: "chk-1", checkpointHash: "chk-1" }),
			]
			for (const snapshot of cases) {
				const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
				decision.stages.length.should.be.greaterThan(0)
			}
		})

		it("trace includes normalize stage with task identity", () => {
			const snapshot = makeSnapshot({ taskId: "trace-test-task" })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const normalizeStage = decision.stages.find((s) => s.stage === "normalize")
			should.exist(normalizeStage)
			normalizeStage?.reason.should.containEql("trace-test-task")
		})
	})

	describe("adapter integration — buildCompletionSnapshot from TaskConfig", () => {
		it("builds snapshot with correct fields from TaskConfig", () => {
			taskState.completionGateBlockCount = 3
			taskState.engineeringVerifiedAt = Date.now()
			taskState.lastGateBlockCheckpointHash = "chk-block"
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-current" }])
			const snapshot = buildCompletionSnapshot(config)
			snapshot.blockCount.should.equal(3)
			snapshot.engineeringVerifiedAt?.should.be.a.Number()
			snapshot.checkpointHash?.should.equal("chk-current")
			snapshot.lastGateBlockCheckpointHash?.should.equal("chk-block")
		})

		it("evaluateCompletionLifecycle returns consistent decision", () => {
			const config = configWithState(taskState)
			const decision = evaluateCompletionLifecycle(config)
			// No blocks, no engineering verified → allow_attempt
			decision.kind.should.equal("allow_attempt")
		})
	})
})
