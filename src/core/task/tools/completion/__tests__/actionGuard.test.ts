import { beforeEach, describe, it } from "mocha"
import "should"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { guardAttemptCompletion, guardCompletionAction, guardRunFinalization } from "../CompletionActionGuard"
import { CompletionLifecycleDecisionEngine } from "../CompletionLifecycleDecisionEngine"
import type { CompletionLifecycleSnapshot } from "../CompletionLifecycleTypes"
import { evaluateCompletionLifecycle } from "../completionSnapshotBuilder"
import { DEFAULT_GATE_REGISTRY } from "../gateRegistry"

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<CompletionLifecycleSnapshot> = {}): CompletionLifecycleSnapshot {
	return {
		taskId: "guard-test-task",
		sessionId: "guard-test-session",
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

describe("CompletionActionGuard — binding action contract enforcement", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("route_to_finalization — attempt_completion is forbidden", () => {
		it("rejects attempt_completion when decision says route_to_finalization", () => {
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("route_to_finalization")

			const result = guardAttemptCompletion(configWithState(taskState), decision)
			result.allowed.should.be.false()
		})

		it("rejection includes decision.kind, nextAllowedAction, and correction", () => {
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const result = guardAttemptCompletion(configWithState(taskState), decision)

			result.allowed.should.be.false()
			if (!result.allowed) {
				// The rejection is a ToolResponse — verify it contains the contract
				const rejectionText = JSON.stringify(result.rejection)
				rejectionText.should.containEql("route_to_finalization")
				rejectionText.should.containEql("run_finalization")
				rejectionText.should.containEql("attempt_completion")
			}
		})

		it("allows run_finalization when decision says route_to_finalization", () => {
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("route_to_finalization")

			const result = guardRunFinalization(configWithState(taskState), decision)
			result.allowed.should.be.true()
		})

		it("canonical route_to_finalization overrides failed advisory gate state", () => {
			const snapshot = makeSnapshot({
				engineeringVerifiedAt: Date.now(),
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				auditGateDecision: {
					blocked: true,
					score: 10,
					effectiveThreshold: 80,
					grade: "F",
					reasons: [{ code: "score_below_threshold", message: "Advisory score below threshold" }],
				},
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)

			decision.kind.should.equal("route_to_finalization")
			decision.nextAllowedAction.should.equal("run_finalization")
			guardRunFinalization(configWithState(taskState), decision).allowed.should.be.true()
		})
	})

	describe("soft_block — attempt_completion and run_finalization are forbidden", () => {
		it("rejects attempt_completion when decision says soft_block", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1", // Unchanged
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("soft_block")
			decision.nextAllowedAction.should.equal("modify_workspace")

			const result = guardAttemptCompletion(configWithState(taskState), decision)
			result.allowed.should.be.false()
		})

		it("rejects run_finalization when decision says soft_block", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("soft_block")

			const result = guardRunFinalization(configWithState(taskState), decision)
			result.allowed.should.be.false()
		})

		it("rejection does not increment any counters", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const config = configWithState(taskState)
			const blockCountBefore = config.taskState.completionGateBlockCount ?? 0
			const mistakesBefore = config.taskState.consecutiveMistakeCount

			const result = guardAttemptCompletion(config, decision)
			result.allowed.should.be.false()

			// Counters must NOT have changed — guard rejections are side-effect-free
			config.taskState.completionGateBlockCount?.should.equal(blockCountBefore)
			config.taskState.consecutiveMistakeCount?.should.equal(mistakesBefore)
		})
	})

	describe("hard_block — all completion actions are forbidden", () => {
		it("rejects attempt_completion when decision says hard_block", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1", // Unchanged
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("hard_block")
			decision.nextAllowedAction.should.equal("stop_and_report")

			const result = guardAttemptCompletion(configWithState(taskState), decision)
			result.allowed.should.be.false()
		})

		it("rejects run_finalization when decision says hard_block", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)

			const result = guardRunFinalization(configWithState(taskState), decision)
			result.allowed.should.be.false()
		})

		it("rejection does not increment circuit breaker budget", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const config = configWithState(taskState)
			const blockCountBefore = config.taskState.completionGateBlockCount ?? 0

			// Repeated rejections must not change the block count
			for (let i = 0; i < 5; i++) {
				const result = guardAttemptCompletion(config, decision)
				result.allowed.should.be.false()
			}
			config.taskState.completionGateBlockCount?.should.equal(blockCountBefore)
		})
	})

	describe("allow_probe — attempt_completion is allowed", () => {
		it("allows attempt_completion when decision says allow_probe", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-old",
				checkpointHash: "chk-new", // Changed
				lastProbeCheckpointHash: undefined,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("allow_probe")
			decision.nextAllowedAction.should.equal("attempt_completion")

			const result = guardAttemptCompletion(configWithState(taskState), decision)
			result.allowed.should.be.true()
		})
	})

	describe("allow_attempt — attempt_completion is allowed", () => {
		it("allows attempt_completion when decision says allow_attempt", () => {
			const snapshot = makeSnapshot({ blockCount: 0 })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("allow_attempt")
			decision.nextAllowedAction.should.equal("attempt_completion")

			const result = guardAttemptCompletion(configWithState(taskState), decision)
			result.allowed.should.be.true()
		})
	})

	describe("deterministic — same snapshot produces same allowed action", () => {
		it("always rejects attempt_completion for the same route_to_finalization snapshot", () => {
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)

			// Evaluate 10 times — every result must be the same
			const results: boolean[] = []
			for (let i = 0; i < 10; i++) {
				const result = guardAttemptCompletion(configWithState(taskState), decision)
				results.push(result.allowed)
			}
			results.every((r) => r === false).should.be.true()
		})

		it("always allows attempt_completion for the same allow_attempt snapshot", () => {
			const snapshot = makeSnapshot({ blockCount: 0 })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)

			const results: boolean[] = []
			for (let i = 0; i < 10; i++) {
				const result = guardAttemptCompletion(configWithState(taskState), decision)
				results.push(result.allowed)
			}
			results.every((r) => r === true).should.be.true()
		})
	})

	describe("agent prose cannot override engine decision", () => {
		it("guard ignores agent reasoning and enforces contract only", () => {
			// Even if the agent "thinks" it should complete (route_to_finalization),
			// the guard enforces the contract — attempt_completion is forbidden.
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("route_to_finalization")
			decision.forbiddenActions.should.containEql("attempt_completion")

			// The guard does not read agent prose — it only checks the contract
			const result = guardCompletionAction("attempt_completion", decision)
			result.allowed.should.be.false()
		})

		it("hallucinated audits cannot affect the decision — only snapshot state matters", () => {
			// The decision is computed from the immutable snapshot, not from
			// any agent-claimed audit state.  A snapshot with no audit metadata
			// and no engineering verification produces allow_attempt, not
			// route_to_finalization — regardless of what the agent claims.
			const snapshot = makeSnapshot({
				auditMetadata: undefined,
				engineeringVerifiedAt: undefined,
				blockCount: 0,
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			decision.kind.should.equal("allow_attempt")
			// The agent cannot "hallucinate" an engineering verification —
			// the snapshot's engineeringVerifiedAt is undefined
			decision.nextAllowedAction.should.equal("attempt_completion")
		})
	})

	describe("every rejected action includes decision.kind, nextAllowedAction, and correction", () => {
		it("route_to_finalization rejection includes all contract fields", () => {
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const result = guardAttemptCompletion(configWithState(taskState), decision)

			result.allowed.should.be.false()
			if (!result.allowed) {
				const text = JSON.stringify(result.rejection)
				text.should.containEql("route_to_finalization")
				text.should.containEql("run_finalization")
			}
		})

		it("soft_block rejection includes all contract fields", () => {
			const snapshot = makeSnapshot({
				blockCount: 2,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const result = guardAttemptCompletion(configWithState(taskState), decision)

			result.allowed.should.be.false()
			if (!result.allowed) {
				const text = JSON.stringify(result.rejection)
				text.should.containEql("soft_block")
				text.should.containEql("modify_workspace")
			}
		})

		it("hard_block rejection includes all contract fields", () => {
			const snapshot = makeSnapshot({
				blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
				lastGateBlockCheckpointHash: "chk-1",
				checkpointHash: "chk-1",
			})
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)
			const result = guardAttemptCompletion(configWithState(taskState), decision)

			result.allowed.should.be.false()
			if (!result.allowed) {
				const text = JSON.stringify(result.rejection)
				text.should.containEql("hard_block")
				text.should.containEql("stop_and_report")
			}
		})
	})

	describe("integration — full lifecycle evaluation + guard", () => {
		it("route_to_finalization via adapter: attempt_completion rejected, run_finalization allowed", () => {
			taskState.engineeringVerifiedAt = Date.now()
			const config = configWithState(taskState)
			const decision = evaluateCompletionLifecycle(config)

			decision.kind.should.equal("route_to_finalization")

			const attemptResult = guardAttemptCompletion(config, decision)
			attemptResult.allowed.should.be.false()

			const finalizationResult = guardRunFinalization(config, decision)
			finalizationResult.allowed.should.be.true()
		})

		it("adapter ignores advisory gate counters when authorizing attempt_completion", () => {
			taskState.completionGateBlockCount = 2
			taskState.lastGateBlockCheckpointHash = "chk-1"
			const config = configWithState(taskState, [{ lastCheckpointHash: "chk-1" }])
			const decision = evaluateCompletionLifecycle(config)

			decision.kind.should.equal("allow_attempt")

			const blockCountBefore = config.taskState.completionGateBlockCount ?? 0
			const result = guardAttemptCompletion(config, decision)
			result.allowed.should.be.true()
			config.taskState.completionGateBlockCount?.should.equal(blockCountBefore)
		})
	})

	describe("unknown tools pass through guard", () => {
		it("non-completion tools are not governed by the action guard", () => {
			const snapshot = makeSnapshot({ engineeringVerifiedAt: Date.now() })
			const decision = CompletionLifecycleDecisionEngine.evaluate(snapshot)

			// A non-completion tool (e.g. "read_file") should pass through
			const result = guardCompletionAction("read_file", decision)
			result.allowed.should.be.true()
		})
	})
})
