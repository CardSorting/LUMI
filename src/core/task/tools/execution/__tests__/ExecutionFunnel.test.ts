import assert from "node:assert/strict"
import type { ToolUse } from "@core/assistant-message"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ApprovalIntent } from "@shared/execution/executionFunnelEvent"
import { DietCodeDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { declareApprovalIntent, type IToolHandler, type ToolResponse } from "../../types/ToolContracts"
import {
	appendSessionStabilityContext,
	computeFastIoReservedSlots,
	ExecutionFunnel,
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
		autoApprovalSettings: structuredClone(DEFAULT_AUTO_APPROVAL_SETTINGS),
		services: {
			browserSession: { hasActiveSession: () => false, closeBrowser: async () => undefined },
			commandPermissionController: { validateCommand: () => ({ allowed: true, reason: "allowed" }) },
			stateManager: { getTrustedCommands: () => [] },
			mcpHub: { connections: [] },
		} as unknown as TaskConfig["services"],
		callbacks: {
			say: async () => undefined,
			ask: async () => ({ response: "yesButtonClicked" }),
			removeLastPartialMessageIfExistsWithType: async () => undefined,
			setActiveHookExecution: async () => undefined,
			clearActiveHookExecution: async () => undefined,
			cancelTask: async () => undefined,
			switchToPlanMode: async () => true,
		} as unknown as TaskConfig["callbacks"],
		...overrides,
	} as TaskConfig
}

function block(name = DietCodeDefaultTool.ATTEMPT, callId = "call-1", params: ToolUse["params"] = {}): ToolUse {
	return { type: "tool_use", name, params, partial: false, call_id: callId }
}

function noConsentIntent(toolBlock: ToolUse): ApprovalIntent {
	return declareApprovalIntent(toolBlock, { description: `Run ${toolBlock.name}`, requirements: [] })
}

function readIntent(toolBlock: ToolUse): ApprovalIntent {
	return declareApprovalIntent(toolBlock, {
		description: "Read a file",
		requirements: [
			{
				capability: "workspace_read",
				path: toolBlock.params.path,
				risk: "low",
				requestedSideEffects: ["read file"],
				autoApprovalEligible: true,
			},
		],
	})
}

function commandIntent(toolBlock: ToolUse): ApprovalIntent {
	return declareApprovalIntent(toolBlock, {
		description: `Execute ${toolBlock.params.command ?? "a command"}`,
		requirements: [
			{
				capability: "command",
				risk: "high",
				requestedSideEffects: ["execute command"],
				autoApprovalEligible: true,
			},
		],
	})
}

function writeIntent(toolBlock: ToolUse): ApprovalIntent {
	return declareApprovalIntent(toolBlock, {
		description: "Write a workspace file",
		requirements: [
			{
				capability: "workspace_write",
				path: toolBlock.params.path,
				scope: "workspace",
				risk: "elevated",
				requestedSideEffects: ["write file"],
				autoApprovalEligible: true,
			},
		],
	})
}

function handler(
	name: DietCodeDefaultTool,
	execute: (config: TaskConfig, toolBlock: ToolUse) => Promise<ToolResponse> = async () => "done",
	getApprovalIntent: (toolBlock: ToolUse) => ApprovalIntent = noConsentIntent,
): IToolHandler {
	return { name, execute, getApprovalIntent, getDescription: () => `[${name}]` }
}

async function run(
	funnel: ExecutionFunnel,
	taskConfig: TaskConfig,
	toolBlock: ToolUse,
	toolHandler: IToolHandler,
	overrides: Partial<Parameters<ExecutionFunnel["execute"]>[0]> = {},
) {
	return funnel.execute({
		config: taskConfig,
		block: toolBlock,
		registered: true,
		handler: toolHandler,
		...overrides,
	})
}

describe("ExecutionFunnel approval authority", () => {
	afterEach(() => sinon.restore())

	it("never exposes a permit before one immutable approval decision", async () => {
		const funnel = new ExecutionFunnel()
		const taskConfig = config()
		let observedPermit: string | undefined
		let observedDecision: string | undefined
		const toolHandler = handler(DietCodeDefaultTool.ATTEMPT, async () => {
			const current = funnel.getCurrentEvent(taskConfig)
			observedPermit = current?.permitId
			observedDecision = current?.approvalDecision?.decisionId
			assert.equal(current?.permitDecisionId, observedDecision)
			return "done"
		})
		const outcome = await run(funnel, taskConfig, block(), toolHandler)

		assert.ok(observedDecision)
		assert.ok(observedPermit)
		assert.equal(outcome.event.permitDecisionId, outcome.event.approvalDecision?.decisionId)
		assert.ok(
			outcome.event.stages.findIndex((stage) => stage.stage === "approval.decision") <
				outcome.event.stages.findIndex((stage) => stage.stage === "permit.issue"),
		)
	})

	it("fails closed when dispatch lacks a valid approval-linked permit", () => {
		const funnel = new ExecutionFunnel()
		assert.throws(
			() => funnel.dispatchAuthorizedOperation(config(), block(), handler(DietCodeDefaultTool.ATTEMPT)),
			/approval-linked ExecutionFunnel permit/,
		)
		assert.throws(
			() =>
				funnel.dispatchAuthorizedDelegatedOperation(
					config(),
					block(DietCodeDefaultTool.ATTEMPT, "parent"),
					block(DietCodeDefaultTool.FILE_READ, "child", { path: "a.ts" }),
					handler(DietCodeDefaultTool.FILE_READ, undefined, readIntent),
				),
			/approval-linked ExecutionFunnel permit/,
		)
	})

	it("rejects a delegated operation that exceeds the recorded parent intent", async () => {
		const funnel = new ExecutionFunnel()
		const taskConfig = config()
		const parentBlock = block(DietCodeDefaultTool.ATTEMPT, "parent-coverage")
		let delegatedDispatches = 0
		const delegated = handler(
			DietCodeDefaultTool.FILE_READ,
			async () => {
				delegatedDispatches++
				return "unreachable"
			},
			readIntent,
		)
		const parent = handler(DietCodeDefaultTool.ATTEMPT, () =>
			funnel.dispatchAuthorizedDelegatedOperation(
				taskConfig,
				parentBlock,
				block(DietCodeDefaultTool.FILE_READ, "child-coverage", { path: "a.ts" }),
				delegated,
			),
		)
		const outcome = await run(funnel, taskConfig, parentBlock, parent)
		assert.equal(delegatedDispatches, 0)
		assert.equal(outcome.event.reasonCode, "operation_failed")
		assert.match(outcome.event.reason, /exceeds the recorded parent approval intent/)
	})

	it("derives governed mutation paths from the pure intent before collision admission", async () => {
		let observedPaths: readonly string[] = []
		let dispatches = 0
		const outcome = await run(
			new ExecutionFunnel(),
			config(),
			block(DietCodeDefaultTool.STABILITY_SCAFFOLD, "dynamic-mutation", { path: "src/new-module.ts" }),
			handler(
				DietCodeDefaultTool.STABILITY_SCAFFOLD,
				async () => {
					dispatches++
					return "unreachable"
				},
				writeIntent,
			),
			{
				lane: "subagent",
				collisionCheck: async (paths) => {
					observedPaths = paths
					return "overlapping workspace mutation"
				},
			},
		)
		assert.deepEqual(observedPaths, ["src/new-module.ts"])
		assert.equal(dispatches, 0)
		assert.equal(outcome.event.reasonCode, "lane_collision")
	})

	it("respects current automatic-approval settings instead of compatibility flags", async () => {
		const disabled = config()
		disabled.autoApprovalSettings.actions.readFiles = false
		;(disabled.autoApprovalSettings as unknown as { enabled: boolean }).enabled = true
		let prompts = 0
		disabled.callbacks.ask = async () => {
			prompts++
			return { response: "yesButtonClicked" }
		}
		const explicit = await run(
			new ExecutionFunnel(),
			disabled,
			block(DietCodeDefaultTool.FILE_READ, "read-explicit", { path: "a.ts" }),
			handler(DietCodeDefaultTool.FILE_READ, undefined, readIntent),
		)
		assert.equal(prompts, 1)
		assert.equal(explicit.event.approvalDecision?.mechanism, "explicit")

		const enabled = config()
		let enabledPrompts = 0
		enabled.callbacks.ask = async () => {
			enabledPrompts++
			return { response: "yesButtonClicked" }
		}
		const automatic = await run(
			new ExecutionFunnel(),
			enabled,
			block(DietCodeDefaultTool.FILE_READ, "read-auto", { path: "a.ts" }),
			handler(DietCodeDefaultTool.FILE_READ, undefined, readIntent),
		)
		assert.equal(enabledPrompts, 0)
		assert.equal(automatic.event.approvalDecision?.mechanism, "automatic")
	})

	it("uses centralized command safety and execution policy for automatic approval", async () => {
		const safeConfig = config()
		safeConfig.autoApprovalSettings.actions.executeAllCommands = false
		let safePrompts = 0
		safeConfig.callbacks.ask = async () => {
			safePrompts++
			return { response: "yesButtonClicked" }
		}
		const safe = await run(
			new ExecutionFunnel(),
			safeConfig,
			block(DietCodeDefaultTool.BASH, "safe-command", { command: "npm test" }),
			handler(DietCodeDefaultTool.BASH, undefined, commandIntent),
		)
		assert.equal(safePrompts, 0)
		assert.equal(safe.event.approvalDecision?.mechanism, "automatic")
		assert.deepEqual(safe.event.approvalPolicyInputs?.commandSafetyTiers, ["verification"])

		const deniedConfig = config()
		deniedConfig.services.commandPermissionController = {
			validateCommand: () => ({ allowed: false, reason: "deny rule", matchedPattern: "blocked" }),
		} as unknown as TaskConfig["services"]["commandPermissionController"]
		let deniedDispatches = 0
		const denied = await run(
			new ExecutionFunnel(),
			deniedConfig,
			block(DietCodeDefaultTool.BASH, "policy-command", { command: "npm test" }),
			handler(
				DietCodeDefaultTool.BASH,
				async () => {
					deniedDispatches++
					return "unreachable"
				},
				commandIntent,
			),
		)
		assert.equal(deniedDispatches, 0)
		assert.equal(denied.event.reasonCode, "policy_denied")
		assert.equal(denied.event.approvalDecision, undefined)
	})

	it("records exactly one explicit approval decision", async () => {
		const taskConfig = config()
		taskConfig.autoApprovalSettings.actions.readFiles = false
		const outcome = await run(
			new ExecutionFunnel(),
			taskConfig,
			block(DietCodeDefaultTool.FILE_READ, "explicit", { path: "a.ts" }),
			handler(DietCodeDefaultTool.FILE_READ, undefined, readIntent),
		)
		assert.equal(outcome.event.stages.filter((stage) => stage.stage === "approval.decision").length, 1)
		assert.equal(outcome.event.approvalDecision?.actor, "user")
	})

	it("terminalizes denial without dispatch", async () => {
		const taskConfig = config()
		taskConfig.autoApprovalSettings.actions.readFiles = false
		taskConfig.callbacks.ask = async () => ({ response: "noButtonClicked" })
		let dispatches = 0
		const outcome = await run(
			new ExecutionFunnel(),
			taskConfig,
			block(DietCodeDefaultTool.FILE_READ, "denied", { path: "a.ts" }),
			handler(
				DietCodeDefaultTool.FILE_READ,
				async () => {
					dispatches++
					return "unreachable"
				},
				readIntent,
			),
		)
		assert.equal(dispatches, 0)
		assert.equal(outcome.event.reasonCode, "approval_denied")
		assert.equal(outcome.event.permitId, undefined)
	})

	it("terminalizes cancellation while approval is pending", async () => {
		const controller = new AbortController()
		const taskConfig = config()
		taskConfig.autoApprovalSettings.actions.readFiles = false
		taskConfig.taskSignal = controller.signal
		let prompted!: () => void
		const promptStarted = new Promise<void>((resolve) => {
			prompted = resolve
		})
		taskConfig.callbacks.ask = async () => {
			prompted()
			return new Promise<never>(() => undefined)
		}
		const pending = run(
			new ExecutionFunnel(),
			taskConfig,
			block(DietCodeDefaultTool.FILE_READ, "cancelled", { path: "a.ts" }),
			handler(DietCodeDefaultTool.FILE_READ, undefined, readIntent),
		)
		await promptStarted
		controller.abort()
		const outcome = await pending
		assert.equal(outcome.event.reasonCode, "approval_cancelled")
		assert.equal(outcome.event.approvalDecision?.status, "cancelled")
		assert.equal(outcome.event.permitId, undefined)
	})

	it("terminalizes approval preparation failure without dispatch", async () => {
		let dispatches = 0
		const outcome = await run(
			new ExecutionFunnel(),
			config(),
			block(DietCodeDefaultTool.FILE_READ, "bad-intent", { path: "a.ts" }),
			handler(
				DietCodeDefaultTool.FILE_READ,
				async () => {
					dispatches++
					return "unreachable"
				},
				() => {
					throw new Error("intent unavailable")
				},
			),
		)
		assert.equal(dispatches, 0)
		assert.equal(outcome.event.reasonCode, "approval_preparation_failed")
	})

	it("fails closed when approval settings are absent or malformed", async () => {
		const taskConfig = config()
		;(taskConfig.autoApprovalSettings as unknown as { version: unknown }).version = "stale"
		let dispatches = 0
		const outcome = await run(
			new ExecutionFunnel(),
			taskConfig,
			block(DietCodeDefaultTool.FILE_READ, "bad-settings", { path: "a.ts" }),
			handler(
				DietCodeDefaultTool.FILE_READ,
				async () => {
					dispatches++
					return "unreachable"
				},
				readIntent,
			),
		)
		assert.equal(dispatches, 0)
		assert.equal(outcome.event.reasonCode, "approval_preparation_failed")
		assert.equal(outcome.event.approvalDecision?.status, "failed")
		assert.equal(outcome.event.permitId, undefined)
	})

	it("uses identical approval authority for parent, sibling, and subagent lanes", async () => {
		for (const lane of ["parent", "sibling", "subagent"] as const) {
			const outcome = await run(
				new ExecutionFunnel(),
				config(),
				block(DietCodeDefaultTool.FILE_READ, `${lane}-call`, { path: "a.ts" }),
				handler(DietCodeDefaultTool.FILE_READ, undefined, readIntent),
				{ lane },
			)
			assert.equal(outcome.event.lane, lane)
			assert.equal(outcome.event.approvalDecision?.mechanism, "automatic")
			assert.equal(outcome.event.permitDecisionId, outcome.event.approvalDecision?.decisionId)
		}
	})

	it("does not reuse decisions across lifecycle generations", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		let dispatches = 0
		const toolHandler = handler(DietCodeDefaultTool.ATTEMPT, async () => {
			dispatches++
			return "done"
		})
		const first = await run(funnel, config(state), block(DietCodeDefaultTool.ATTEMPT, "same-call"), toolHandler)
		state.executionGeneration = "next-generation"
		const second = await run(funnel, config(state), block(DietCodeDefaultTool.ATTEMPT, "same-call"), toolHandler)
		assert.equal(dispatches, 2)
		assert.notEqual(first.event.approvalDecision?.decisionId, second.event.approvalDecision?.decisionId)
		assert.equal(second.event.taskGeneration, "next-generation")
	})

	it("rejects an active permit after its task generation becomes stale", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		const taskConfig = config(state)
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let staleAttempt!: Promise<ToolResponse>
		const toolBlock = block(DietCodeDefaultTool.ATTEMPT, "stale-permit")
		const toolHandler = handler(DietCodeDefaultTool.ATTEMPT, async () => {
			staleAttempt = (async () => {
				await gate
				return funnel.dispatchAuthorizedOperation(taskConfig, toolBlock, toolHandler)
			})()
			return "done"
		})
		await run(funnel, taskConfig, toolBlock, toolHandler)
		state.executionGeneration = "replacement-generation"
		release()
		await assert.rejects(staleAttempt, /approval-linked ExecutionFunnel permit/)
	})

	it("rejects sequential and concurrent replays", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		let release!: () => void
		const waiting = new Promise<void>((resolve) => {
			release = resolve
		})
		let dispatches = 0
		const toolHandler = handler(DietCodeDefaultTool.ATTEMPT, async () => {
			dispatches++
			await waiting
			return "done"
		})
		const taskConfig = config(state)
		const toolBlock = block(DietCodeDefaultTool.ATTEMPT, "replay")
		const first = run(funnel, taskConfig, toolBlock, toolHandler)
		const concurrent = await run(funnel, taskConfig, toolBlock, toolHandler)
		release()
		await first
		const sequential = await run(funnel, taskConfig, toolBlock, toolHandler)
		assert.equal(dispatches, 1)
		assert.equal(concurrent.event.reasonCode, "duplicate_invocation")
		assert.equal(sequential.event.reasonCode, "duplicate_invocation")
		for (let index = 0; index < 30; index++) {
			await run(
				funnel,
				taskConfig,
				block(DietCodeDefaultTool.ATTEMPT, `later-${index}`),
				handler(DietCodeDefaultTool.ATTEMPT),
			)
		}
		const afterHistoryEviction = await run(funnel, taskConfig, toolBlock, toolHandler)
		assert.equal(afterHistoryEviction.event.reasonCode, "duplicate_invocation")
		assert.equal(dispatches, 1)
	})

	it("keeps retries inside the original decision and permit", async () => {
		const funnel = new ExecutionFunnel()
		const taskConfig = config()
		taskConfig.autoApprovalSettings.actions.readFiles = false
		let prompts = 0
		taskConfig.callbacks.ask = async () => {
			prompts++
			return { response: "yesButtonClicked" }
		}
		let attempts = 0
		const toolHandler = handler(
			DietCodeDefaultTool.FILE_READ,
			async () =>
				funnel.executeReliableAction(
					taskConfig.taskId,
					taskConfig.taskState.executionGeneration,
					async () => {
						attempts++
						if (attempts === 1) throw new Error("UNAVAILABLE")
						return "done"
					},
					{ maxRetries: 2, backoffMs: 0 },
				),
			readIntent,
		)
		const outcome = await run(
			funnel,
			taskConfig,
			block(DietCodeDefaultTool.FILE_READ, "retry", { path: "a.ts" }),
			toolHandler,
		)
		assert.equal(attempts, 2)
		assert.equal(prompts, 1)
		assert.equal(outcome.event.stages.filter((stage) => stage.stage === "approval.decision").length, 1)
	})

	it("does not let compatibility flags override the modern event", async () => {
		const state = new TaskState()
		const funnel = new ExecutionFunnel()
		await run(funnel, config(state), block(), handler(DietCodeDefaultTool.ATTEMPT))
		Object.assign(state as unknown as Record<string, unknown>, {
			didRejectTool: true,
			didAlreadyUseTool: true,
		})
		assert.deepEqual(funnel.getTurnControl(state, true), {
			rejected: false,
			toolBudgetExhausted: false,
			suppressFurtherContent: false,
		})
	})

	it("does not reinterpret execution success as task completion", async () => {
		const state = new TaskState()
		const before = state.completionFunnelEventJson
		const outcome = await run(new ExecutionFunnel(), config(state), block(), handler(DietCodeDefaultTool.ATTEMPT))
		assert.equal(outcome.event.phase, "succeeded")
		assert.equal(state.completionFunnelEventJson, before)
	})

	it("publishes deeply immutable audit stages in their original order", async () => {
		const outcome = await run(new ExecutionFunnel(), config(), block(), handler(DietCodeDefaultTool.ATTEMPT))
		const stages = outcome.event.stages.map((stage) => stage.stage)
		assert.equal(Object.isFrozen(outcome.event), true)
		assert.equal(Object.isFrozen(outcome.event.stages), true)
		assert.equal(Object.isFrozen(outcome.event.approvalDecision), true)
		assert.throws(() => outcome.event.stages.push({ stage: "tamper", result: "passed", reason: "", decisive: false }))
		assert.deepEqual(
			outcome.event.stages.map((stage) => stage.stage),
			stages,
		)
	})

	it("keeps execution classification and fast paths co-located", () => {
		assert.equal(isIoAuthorityTool(DietCodeDefaultTool.FILE_READ), true)
		assert.equal(isLocalMutationTool(DietCodeDefaultTool.FILE_EDIT), true)
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

	it("keeps warm stability helpers co-located", () => {
		const spider = { nodes: new Map() }
		const taskConfig = {
			cwd: "/tmp",
			isSubagentExecution: false,
			universalGuard: { engine: { getNodes: () => new Map() }, getSpiderEngine: () => spider },
		} as TaskConfig
		assert.equal(appendSessionStabilityContext(taskConfig, "src/a.ts", "file body"), "file body")
		assert.equal(resolveSessionSpiderEngine(taskConfig), spider)
	})
})
