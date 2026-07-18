import assert from "node:assert/strict"
import { DietCodeDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	appendSessionStabilityContext,
	computeFastIoReservedSlots,
	ExecutionFunnel,
	hasWorkspaceLocalIoAuthority,
	isIoAuthorityTool,
	isLocalMutationTool,
	resolveSessionSpiderEngine,
	shouldBypassGuardForLaneIoTool,
	shouldBypassGuardForParentIoTool,
	shouldCloseBrowserBetweenTools,
	shouldDeferLaneGuardPostExecution,
	shouldDeferParentGuardPostExecution,
	shouldSkipLayerInjectionForParentIoTool,
	shouldSkipPreToolUseForLaneIoTool,
	shouldSkipPreToolUseForParentIoTool,
	shouldUseIoAuthorityReadFastPath,
} from "../ExecutionFunnel"

function config(state = new TaskState(), overrides: Partial<TaskConfig> = {}): TaskConfig {
	return {
		taskId: "task-1",
		ulid: "task-1",
		cwd: "/tmp/execution-funnel",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		enableParallelToolCalling: true,
		isSubagentExecution: false,
		taskState: state,
		taskSignal: new AbortController().signal,
		services: {
			browserSession: { hasActiveSession: () => false, closeBrowser: async () => undefined },
		} as unknown as TaskConfig["services"],
		callbacks: {
			say: async () => undefined,
			setActiveHookExecution: async () => undefined,
			clearActiveHookExecution: async () => undefined,
			cancelTask: async () => undefined,
		} as unknown as TaskConfig["callbacks"],
		...overrides,
	} as TaskConfig
}

describe("ExecutionFunnel", () => {
	afterEach(() => sinon.restore())

	it("is the fail-closed registration authority and never dispatches blocked work", async () => {
		const funnel = new ExecutionFunnel()
		let dispatched = false
		const outcome = await funnel.execute({
			config: config(),
			block: { type: "tool_use", name: DietCodeDefaultTool.FILE_READ, params: {}, partial: false },
			registered: false,
			operation: async () => {
				dispatched = true
				return "unreachable"
			},
		})

		assert.equal(dispatched, false)
		assert.equal(outcome.event.phase, "blocked")
		assert.equal(outcome.event.reasonCode, "unregistered_tool")
		assert.equal(outcome.event.stages.at(-1)?.decisive, true)
	})

	it("publishes one complete terminal event with an issued permit and ordered trace", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		const outcome = await funnel.execute({
			config: config(state),
			block: {
				type: "tool_use",
				name: DietCodeDefaultTool.ATTEMPT,
				params: { result: "done" },
				partial: false,
				call_id: "call-1",
			},
			registered: true,
			operation: async () => "done",
		})

		assert.equal(outcome.event.phase, "succeeded")
		assert.equal(outcome.event.terminal, true)
		assert.ok(outcome.event.permitId)
		assert.equal(outcome.event.stages[0]?.stage, "invocation.idempotency")
		assert.equal(state.executionFunnelHistory?.length, 1)
		assert.deepEqual(JSON.parse(state.executionFunnelEventJson ?? "{}"), outcome.event)
	})

	it("fails closed when a coordinator tries to dispatch without a funnel permit", () => {
		const funnel = new ExecutionFunnel()
		assert.throws(
			() =>
				funnel.dispatchAuthorizedOperation(
					config(),
					{ type: "tool_use", name: DietCodeDefaultTool.ATTEMPT, params: {}, partial: false },
					{ execute: async () => "unreachable" },
				),
			/no current ExecutionFunnel permit/,
		)
	})

	it("records adapter preparation failures without demoting an existing terminal event", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		const block = {
			type: "tool_use" as const,
			name: DietCodeDefaultTool.ATTEMPT,
			params: {},
			partial: false,
			call_id: "prepared-call",
		}
		const failed = funnel.recordPreparationFailure(state, "task-1", block, "parent", new Error("config unavailable"))
		assert.equal(failed.phase, "failed")
		assert.equal(failed.reasonCode, "preparation_failed")
		assert.equal(failed.stages[0]?.stage, "adapter.preparation")

		const preserved = funnel.recordPreparationFailure(state, "task-1", block, "parent", new Error("presentation failed"))
		assert.deepEqual(preserved, failed)
		assert.equal(state.executionFunnelHistory?.length, 1)
	})

	it("settles successful-result enrichment before publishing terminal success", async () => {
		const outcome = await new ExecutionFunnel().execute({
			config: config(),
			block: { type: "tool_use", name: DietCodeDefaultTool.ATTEMPT, params: {}, partial: false },
			registered: true,
			operation: async () => "raw",
			postProcess: async (result) => `${result}:enriched`,
		})

		assert.equal(outcome.result, "raw:enriched")
		assert.equal(outcome.event.phase, "succeeded")
		assert.equal(
			outcome.event.stages.some((stage) => stage.stage === "result.post_process"),
			true,
		)
	})

	it("publishes failure when successful-result enrichment cannot settle", async () => {
		const outcome = await new ExecutionFunnel().execute({
			config: config(),
			block: { type: "tool_use", name: DietCodeDefaultTool.ATTEMPT, params: {}, partial: false },
			registered: true,
			operation: async () => "raw",
			postProcess: async () => {
				throw new Error("projection failed")
			},
		})

		assert.equal(outcome.result, undefined)
		assert.equal(outcome.event.phase, "failed")
		assert.match(outcome.event.reason, /projection failed/)
	})

	it("uses the modern event instead of stale compatibility flags for turn control", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		await funnel.execute({
			config: config(state),
			block: { type: "tool_use", name: DietCodeDefaultTool.ATTEMPT, params: {}, partial: false },
			registered: true,
			operation: async () => "done",
		})
		state.didRejectTool = true

		assert.deepEqual(funnel.getTurnControl(state, true), {
			rejected: false,
			toolBudgetExhausted: false,
			suppressFurtherContent: false,
		})
	})

	it("rejects a replayed invocation ID without dispatching it twice", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		const block = {
			type: "tool_use" as const,
			name: DietCodeDefaultTool.ATTEMPT,
			params: { result: "done" },
			partial: false,
			call_id: "idempotent-call",
		}
		let dispatches = 0
		await funnel.execute({
			config: config(state),
			block,
			registered: true,
			operation: async () => {
				dispatches++
				return "done"
			},
		})
		const replay = await funnel.execute({
			config: config(state),
			block,
			registered: true,
			operation: async () => {
				dispatches++
				return "done"
			},
		})

		assert.equal(dispatches, 1)
		assert.equal(replay.event.reasonCode, "duplicate_invocation")
		assert.equal(replay.event.phase, "blocked")
	})

	it("rejects concurrent replay before either invocation reaches history", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		let release!: () => void
		const waiting = new Promise<void>((resolve) => {
			release = resolve
		})
		const block = {
			type: "tool_use" as const,
			name: DietCodeDefaultTool.ATTEMPT,
			params: {},
			partial: false,
			call_id: "concurrent-call",
		}
		const first = funnel.execute({
			config: config(state),
			block,
			registered: true,
			operation: async () => {
				await waiting
				return "done"
			},
		})
		const replay = await funnel.execute({
			config: config(state),
			block,
			registered: true,
			operation: async () => "unreachable",
		})
		release()
		const original = await first

		assert.equal(replay.event.reasonCode, "duplicate_invocation")
		assert.equal(original.event.phase, "succeeded")
	})

	it("records prior rejection as a terminal denial", async () => {
		const state = new TaskState()
		state.didRejectTool = true
		const outcome = await new ExecutionFunnel().execute({
			config: config(state),
			block: { type: "tool_use", name: DietCodeDefaultTool.FILE_READ, params: {}, partial: false },
			registered: true,
			operation: async () => "unreachable",
		})

		assert.equal(outcome.event.phase, "denied")
		assert.equal(outcome.event.reasonCode, "prior_user_rejection")
	})

	it("owns timeout timers and clears them on success and deadline", async () => {
		const clock = sinon.useFakeTimers()
		const funnel = new ExecutionFunnel()
		assert.equal(
			await funnel.executeReliableAction("fast", async () => "done", {
				timeoutMs: 60_000,
				maxRetries: 1,
				concurrencyGroup: "timer-fast",
			}),
			"done",
		)
		assert.equal(clock.countTimers(), 0)

		const pending = funnel.executeReliableAction("slow", () => new Promise<never>(() => undefined), {
			timeoutMs: 25,
			maxRetries: 1,
			concurrencyGroup: "timer-slow",
		})
		await clock.tickAsync(25)
		await assert.rejects(pending, /timed out after 25ms/)
		assert.equal(clock.countTimers(), 0)
	})

	it("keeps execution classification and fast paths in the same authority", () => {
		assert.equal(isIoAuthorityTool(DietCodeDefaultTool.FILE_READ), true)
		assert.equal(isLocalMutationTool(DietCodeDefaultTool.FILE_EDIT), true)
		assert.equal(hasWorkspaceLocalIoAuthority(false, true), true)
		assert.equal(shouldBypassGuardForParentIoTool(DietCodeDefaultTool.SEARCH), true)
		assert.equal(shouldBypassGuardForLaneIoTool("read_only", DietCodeDefaultTool.FILE_READ), true)
		assert.equal(shouldUseIoAuthorityReadFastPath(DietCodeDefaultTool.FILE_READ, "mutation"), false)
		assert.equal(computeFastIoReservedSlots(6), 2)
		assert.equal(shouldDeferParentGuardPostExecution(DietCodeDefaultTool.FILE_EDIT, false), true)
		assert.equal(shouldDeferLaneGuardPostExecution("read_only", DietCodeDefaultTool.FILE_READ), false)
		assert.equal(shouldSkipPreToolUseForLaneIoTool("read_only", DietCodeDefaultTool.SEARCH), true)
		assert.equal(shouldSkipPreToolUseForParentIoTool(DietCodeDefaultTool.FILE_READ, false), true)
		assert.equal(shouldCloseBrowserBetweenTools(DietCodeDefaultTool.FILE_READ, true), true)
		assert.equal(shouldSkipLayerInjectionForParentIoTool(DietCodeDefaultTool.BASH), false)
	})

	it("keeps warm stability context helpers co-located without rebuilding the graph", () => {
		const spider = { nodes: new Map() }
		const taskConfig = {
			cwd: "/tmp",
			isSubagentExecution: false,
			universalGuard: {
				engine: { getNodes: () => new Map() },
				getSpiderEngine: () => spider,
			},
		} as TaskConfig
		assert.equal(appendSessionStabilityContext(taskConfig, "src/a.ts", "file body"), "file body")
		assert.equal(resolveSessionSpiderEngine(taskConfig), spider)
	})
})
