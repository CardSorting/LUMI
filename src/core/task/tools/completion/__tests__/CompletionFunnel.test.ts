import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { expect } from "chai"
import { describe, it } from "mocha"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	buildGateRegistry,
	CompletionFunnelEvaluator,
	type CompletionFunnelSnapshot,
	cacheCompletionFunnelEvent,
	decisionToCompletionFunnelEvent,
	evaluateCircuitBreaker,
	evaluateCompletionFunnel,
	guardCompletionAction,
} from "../CompletionFunnel"

function snapshot(overrides: Partial<CompletionFunnelSnapshot> = {}): CompletionFunnelSnapshot {
	return {
		taskId: "task-1",
		sessionId: "session-1",
		checkpointHash: "checkpoint-1",
		graphRevision: 1,
		registry: {
			gates: buildGateRegistry([
				{ id: "audit", status: "active" },
				{ id: "roadmap", status: "active" },
			]),
		},
		resultFingerprint: "result-1",
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
		lastProbeCheckpointHash: undefined,
		now: 10_000,
		...overrides,
	}
}

function config(): TaskConfig {
	return {
		taskId: "task-1",
		taskState: new TaskState(),
		messageState: { getDietCodeMessages: () => [] },
		auditCompletionGateEnabled: false,
	} as unknown as TaskConfig
}

describe("CompletionFunnel monolith", () => {
	it("emits one ready action when all stages pass", () => {
		const decision = CompletionFunnelEvaluator.evaluate(snapshot())
		expect(decision.kind).to.equal("allow_attempt")
		expect(decision.nextAllowedAction).to.equal("attempt_completion")
		expect(decision.stages.some((stage) => stage.stage === "core_policy")).to.equal(true)
	})

	it("blocks a duplicate result on an unchanged checkpoint", () => {
		const decision = CompletionFunnelEvaluator.evaluate(
			snapshot({
				blockCount: 1,
				lastGateBlockCheckpointHash: "checkpoint-1",
				lastBlockedResultFingerprint: "result-1",
			}),
		)
		expect(decision.kind).to.equal("soft_block")
		expect(decision.nextAllowedAction).to.equal("modify_workspace")
	})

	it("allows exactly one half-open probe after workspace progress", () => {
		const probe = snapshot({
			blockCount: MAX_COMPLETION_GATE_BLOCK_COUNT,
			checkpointHash: "checkpoint-2",
			lastGateBlockCheckpointHash: "checkpoint-1",
		})
		expect(evaluateCircuitBreaker(probe).state).to.equal("half_open")
		expect(CompletionFunnelEvaluator.evaluate(probe).kind).to.equal("allow_probe")
		expect(evaluateCircuitBreaker({ ...probe, lastProbeCheckpointHash: "checkpoint-2" }).state).to.equal("tripped")
	})

	it("represents terminal success as completed with no second action", () => {
		const taskConfig = config()
		const allowed = CompletionFunnelEvaluator.evaluate(snapshot())
		const event = decisionToCompletionFunnelEvent(taskConfig, allowed, {
			decisionId: "decision-1",
			committedAt: 123,
		})
		expect(event.phase).to.equal("completed")
		expect(event.terminal).to.equal(true)
		expect(event.nextAllowedAction).to.equal("none")
		expect(event.forbiddenActions).to.deep.equal(["attempt_completion"])
	})

	it("never lets a cached terminal event regress to pending", () => {
		const taskConfig = config()
		const terminal = decisionToCompletionFunnelEvent(taskConfig, CompletionFunnelEvaluator.evaluate(snapshot()), {
			decisionId: "decision-1",
			committedAt: 123,
		})
		cacheCompletionFunnelEvent(taskConfig, terminal)
		const decision = evaluateCompletionFunnel(taskConfig)
		expect(decision.kind).to.equal("completed")
		expect(decision.nextAllowedAction).to.equal("none")
	})

	it("refuses to cache or publish a non-terminal event over a terminal event", () => {
		const taskConfig = config()
		const allowed = CompletionFunnelEvaluator.evaluate(snapshot())
		const terminal = decisionToCompletionFunnelEvent(taskConfig, allowed, {
			decisionId: "decision-1",
			committedAt: 123,
		})
		cacheCompletionFunnelEvent(taskConfig, terminal)
		const accepted = cacheCompletionFunnelEvent(taskConfig, decisionToCompletionFunnelEvent(taskConfig, allowed))
		expect(accepted).to.deep.equal(terminal)
		expect(JSON.parse(taskConfig.taskState.completionFunnelEventJson ?? "{}").terminal).to.equal(true)
	})

	it("keeps the first terminal event immutable", () => {
		const taskConfig = config()
		const allowed = CompletionFunnelEvaluator.evaluate(snapshot())
		const first = decisionToCompletionFunnelEvent(taskConfig, allowed, {
			decisionId: "decision-1",
			committedAt: 123,
		})
		const conflicting = decisionToCompletionFunnelEvent(taskConfig, allowed, {
			decisionId: "decision-2",
			committedAt: 456,
		})
		cacheCompletionFunnelEvent(taskConfig, first)
		expect(cacheCompletionFunnelEvent(taskConfig, conflicting)).to.deep.equal(first)
	})

	it("rejects another completion action after the terminal decision", () => {
		const taskConfig = config()
		const terminal = decisionToCompletionFunnelEvent(taskConfig, CompletionFunnelEvaluator.evaluate(snapshot()), {
			decisionId: "decision-1",
			committedAt: 123,
		})
		cacheCompletionFunnelEvent(taskConfig, terminal)
		const guarded = guardCompletionAction("attempt_completion", evaluateCompletionFunnel(taskConfig))
		expect(guarded.allowed).to.equal(false)
	})
})
