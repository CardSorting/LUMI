import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { expect } from "chai"
import { describe, it } from "mocha"
import {
	bindTaskLifecycleAuthority,
	createInMemoryTaskLifecycleFunnel,
	getTaskLifecycleAuthority,
} from "../../../lifecycle/TaskLifecycleFunnel"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	buildGateRegistry,
	CompletionFunnelEvaluator,
	type CompletionFunnelSnapshot,
	cacheCompletionFunnelEvent,
	commitCompletionLifecycleFact,
	decisionToCompletionFunnelEvent,
	evaluateCircuitBreaker,
	evaluateCompletionFunnel,
	guardCompletionAction,
	isTaskHarnessTerminal,
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
	const taskState = new TaskState()
	bindTaskLifecycleAuthority(taskState, createInMemoryTaskLifecycleFunnel())
	return {
		taskId: "task-1",
		taskState,
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

	it("commits one authoritative lifecycle event from a CompletionFunnel fact", async () => {
		const taskConfig = config()
		const authority = getTaskLifecycleAuthority(taskConfig.taskState)
		const active = await authority.ensureActive(taskConfig.taskState, taskConfig.taskId, {
			source: "test",
			reason: "Prepare completion integration fixture.",
		})
		expect(active.kind).to.equal("committed")
		const historyBefore = taskConfig.taskState.lifecycleFunnelHistory?.length ?? 0
		await commitCompletionLifecycleFact(taskConfig, "decision-1", Date.now())
		const record = authority.readProjection(taskConfig.taskState)
		expect(record?.state).to.equal("terminal")
		expect(record?.terminalOutcome).to.equal("completed")
		expect(taskConfig.taskState.lifecycleFunnelHistory?.length).to.equal(historyBefore + 1)
		expect(taskConfig.taskState.lifecycleFunnelHistory?.at(-1)?.transition).to.equal("settle_completion")
		expect(isTaskHarnessTerminal(taskConfig.taskState)).to.equal(true)
	})

	it("does not let a UI completion projection create lifecycle truth", () => {
		const taskConfig = config()
		const terminal = decisionToCompletionFunnelEvent(taskConfig, CompletionFunnelEvaluator.evaluate(snapshot()), {
			decisionId: "projection-only",
			committedAt: 123,
		})
		cacheCompletionFunnelEvent(taskConfig, terminal)
		expect(isTaskHarnessTerminal(taskConfig.taskState)).to.equal(false)
	})

	describe("preflight validation stages", () => {
		it("skips preflight checks when result/command/progress are not provided", () => {
			const decision = CompletionFunnelEvaluator.evaluate(snapshot())
			expect(decision.kind).to.equal("allow_attempt")
			const qualityStage = decision.stages.find((s) => s.stage === "quality")
			expect(qualityStage?.result).to.equal("not_applicable")
		})

		it("fails quality check if result summary is empty or ends with a question", () => {
			const emptyDecision = CompletionFunnelEvaluator.evaluate(snapshot({ result: "" }))
			expect(emptyDecision.kind).to.equal("soft_block")
			expect(emptyDecision.reason).to.contain("empty")

			const questionDecision = CompletionFunnelEvaluator.evaluate(snapshot({ result: "Done. Is there anything else?" }))
			expect(questionDecision.kind).to.equal("soft_block")
			expect(questionDecision.reason).to.contain("question")
		})

		it("fails min_length if result summary is too brief", () => {
			const briefDecision = CompletionFunnelEvaluator.evaluate(snapshot({ result: "Done" }))
			expect(briefDecision.kind).to.equal("soft_block")
			expect(briefDecision.reason).to.contain("too brief")
		})

		it("fails checklist_in_result if checklist formatting is in the result summary", () => {
			const checklistDecision = CompletionFunnelEvaluator.evaluate(
				snapshot({ result: "Here is what I did:\n- [x] Subtask 1\n- [x] Subtask 2" }),
			)
			expect(checklistDecision.kind).to.equal("soft_block")
			expect(checklistDecision.reason).to.contain("checklist")
		})

		it("fails task_progress_required when focus chain is enabled but progress is missing", () => {
			const decision = CompletionFunnelEvaluator.evaluate(
				snapshot({
					focusChainEnabled: true,
					focusChainChecklist: "- [x] Subtask 1",
					taskProgress: undefined,
				}),
			)
			expect(decision.kind).to.equal("soft_block")
			expect(decision.reason).to.contain("missing")
		})

		it("fails task_progress_complete when progress checklist has incomplete items", () => {
			const decision = CompletionFunnelEvaluator.evaluate(
				snapshot({
					focusChainEnabled: true,
					focusChainChecklist: "- [ ] Subtask 1",
					taskProgress: "- [ ] Subtask 1",
				}),
			)
			expect(decision.kind).to.equal("soft_block")
			expect(decision.reason).to.contain("incomplete")
		})

		it("fails task_progress_align when progress checklist labels are misaligned with focus chain", () => {
			const decision = CompletionFunnelEvaluator.evaluate(
				snapshot({
					focusChainEnabled: true,
					focusChainChecklist: "- [x] Subtask 1\n- [x] Subtask 2",
					taskProgress: "- [x] Subtask 1",
				}),
			)
			expect(decision.kind).to.equal("soft_block")
			expect(decision.reason).to.contain("task_progress has")
		})

		it("fails focus_chain when active focus chain has incomplete items", () => {
			const decision = CompletionFunnelEvaluator.evaluate(
				snapshot({
					focusChainEnabled: true,
					focusChainChecklist: "- [ ] Subtask 1",
					taskProgress: "- [x] Subtask 1",
				}),
			)
			expect(decision.kind).to.equal("soft_block")
			expect(focusChainStageFailed(decision)).to.equal(true)
		})

		it("fails demo_command if a blocked demo command is provided", () => {
			const decision = CompletionFunnelEvaluator.evaluate(
				snapshot({
					result: "This is a long enough and detailed summary of the task and what was done to resolve it. We successfully verified all gates and everything is complete.",
					command: "echo hello",
				}),
			)
			expect(decision.kind).to.equal("soft_block")
			expect(decision.reason).to.contain("showcase live output")
		})
	})
})

function focusChainStageFailed(decision: any): boolean {
	const stage = decision.stages.find((s: any) => s.stage === "focus_chain")
	return stage?.result === "failed"
}
