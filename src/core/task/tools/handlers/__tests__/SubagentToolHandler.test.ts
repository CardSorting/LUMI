import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { DietCodeSubagentUsageInfo } from "@shared/ExtensionMessage"
import { DietCodeDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { TaskState } from "../../../TaskState"
import { AgentConfigLoader } from "../../subagent/AgentConfigLoader"
import { GovernedSwarmCoordinator } from "../../subagent/GovernedSwarmCoordinator"
import { computeSwarmArtifactChecksum } from "../../subagent/ResumeSwarmFromArtifact"
import { loadSwarmEnvelope } from "../../subagent/SubagentExecutionStore"
import { SubagentRunner } from "../../subagent/SubagentRunner"
import type { TaskConfig } from "../../types/TaskConfig"
import { createUIHelpers } from "../../types/UIHelpers"
import { UseSubagentsToolHandler } from "../SubagentToolHandler"

function createConfig(options?: {
	autoApproveSafe?: boolean
	autoApproveAll?: boolean
	autoApproveEdits?: boolean
	taskAskResponse?: "yesButtonClicked" | "noButtonClicked"
	subagentsEnabled?: boolean
}) {
	const taskState = new TaskState()
	const askResponse = options?.taskAskResponse ?? "yesButtonClicked"
	const subagentsEnabled = options?.subagentsEnabled ?? true

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: askResponse }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		executeCommandTool: sinon.stub().resolves([false, "ok"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon
			.stub()
			.callsFake((toolName: DietCodeDefaultTool) =>
				toolName === DietCodeDefaultTool.FILE_EDIT
					? [options?.autoApproveEdits ?? options?.autoApproveAll ?? false, false]
					: [options?.autoApproveSafe ?? false, options?.autoApproveAll ?? false],
			),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
		postStateToWebview: sinon.stub().resolves(),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		updateTaskHistory: sinon.stub().resolves([]),
		applyLatestBrowserSettings: sinon.stub().resolves(undefined),
		switchToActMode: sinon.stub().resolves(false),
		switchToPlanMode: sinon.stub().resolves(false),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		getActiveHookExecution: sinon.stub().resolves(undefined),
		runUserPromptSubmitHook: sinon.stub().resolves({}),
	}

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		enableParallelToolCalling: true,
		context: {},
		taskState,
		messageState: {},
		api: {
			getModel: () => ({ id: "openai/gpt-5", info: {} }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: {
				executeSafeCommands: false,
				executeAllCommands: false,
			},
		},
		autoApprover: {
			shouldAutoApproveTool: sinon
				.stub()
				.callsFake((toolName: DietCodeDefaultTool) =>
					toolName === DietCodeDefaultTool.FILE_EDIT
						? [options?.autoApproveEdits ?? options?.autoApproveAll ?? false, false]
						: [options?.autoApproveSafe ?? false, options?.autoApproveAll ?? false],
				),
		},
		browserSettings: {},
		focusChainSettings: {},
		services: {
			stateManager: {
				getGlobalStateKey: (key: string) => (key === "nativeToolCallEnabled" ? true : undefined),
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") {
						return "act"
					}
					if (key === "customPrompt") {
						return undefined
					}
					if (key === "subagentsEnabled") {
						return subagentsEnabled
					}
					return undefined
				},
				getApiConfiguration: () => ({
					planModeApiProvider: "openai",
					actModeApiProvider: "openai",
				}),
			},
			mcpHub: {},
		},
		callbacks,
		coordinator: {
			getHandler: sinon.stub(),
		},
	} as unknown as TaskConfig

	return { config, callbacks, taskState }
}

function emptyStats() {
	return {
		toolCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		contextTokens: 0,
		contextWindow: 200000,
		contextUsagePercentage: 0,
	}
}

describe("SubagentToolHandler", () => {
	const tempDirs: string[] = []

	afterEach(async () => {
		sinon.restore()
		await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
	})

	it("returns missing parameter error when no prompts are provided", async () => {
		const { config, callbacks, taskState } = createConfig()
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {},
			partial: false,
		})

		assert.equal(result, "missing")
		assert.equal(taskState.consecutiveMistakeCount, 1)
		sinon.assert.calledOnce(callbacks.sayAndCreateMissingParamError)
	})

	it("returns an error when subagents are disabled", async () => {
		const { config } = createConfig({ subagentsEnabled: false })
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "first prompt",
			},
			partial: false,
		})

		assert.ok((result as string).includes("Subagents are disabled. Enable them in Settings > Features to use this tool."))
	})

	it("rejects depth overflow before approval or lease acquisition", async () => {
		const { config, callbacks } = createConfig()
		config.recursionDepth = 3
		const leaseStub = sinon.stub(GovernedSwarmCoordinator.prototype, "acquireSwarmOrchestrationLease")

		const result = await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "too deep" },
			partial: false,
		})

		assert.match(String(result), /Recursion Limit Reached/)
		sinon.assert.notCalled(callbacks.ask)
		sinon.assert.notCalled(leaseStub)
	})

	it("streams partial use_subagents approval as ask when not auto-approved", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: false, autoApproveAll: false })
		const handler = new UseSubagentsToolHandler()
		const uiHelpers = createUIHelpers(config)

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: DietCodeDefaultTool.USE_SUBAGENTS,
				params: {
					prompt_1: "[execution_mode:read_only] first prompt",
					prompt_2: "[execution_mode:read_only] second prompt",
				},
				partial: true,
			},
			uiHelpers,
		)

		sinon.assert.calledOnce(callbacks.removeLastPartialMessageIfExistsWithType)
		sinon.assert.calledWithExactly(callbacks.removeLastPartialMessageIfExistsWithType, "say", "use_subagents")
		sinon.assert.calledOnce(callbacks.ask)
		sinon.assert.calledWithMatch(callbacks.ask, "use_subagents", sinon.match.string, true)

		const payload = JSON.parse(callbacks.ask.firstCall.args[1])
		assert.deepEqual(payload.prompts, ["[execution_mode:read_only] first prompt", "[execution_mode:read_only] second prompt"])
		sinon.assert.notCalled(callbacks.say)
	})

	it("streams partial use_subagents approval as say when auto-approved", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		const handler = new UseSubagentsToolHandler()
		const uiHelpers = createUIHelpers(config)

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: DietCodeDefaultTool.USE_SUBAGENTS,
				params: {
					prompt_1: "[execution_mode:read_only] first prompt",
					prompt_2: "[execution_mode:read_only] second prompt",
				},
				partial: true,
			},
			uiHelpers,
		)

		sinon.assert.calledOnce(callbacks.removeLastPartialMessageIfExistsWithType)
		sinon.assert.calledWithExactly(callbacks.removeLastPartialMessageIfExistsWithType, "ask", "use_subagents")
		sinon.assert.calledOnce(callbacks.say)
		sinon.assert.calledWithMatch(callbacks.say, "use_subagents", sinon.match.string, undefined, undefined, true)

		const payload = JSON.parse(callbacks.say.firstCall.args[1])
		assert.deepEqual(payload.prompts, ["[execution_mode:read_only] first prompt", "[execution_mode:read_only] second prompt"])
		sinon.assert.notCalled(callbacks.ask)
	})

	it("uses one approval for the full batch and stops on denial", async () => {
		const { config, callbacks, taskState } = createConfig({ taskAskResponse: "noButtonClicked" })
		const runStub = sinon.stub(SubagentRunner.prototype, "run")
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "[execution_mode:read_only] one",
				prompt_2: "two",
			},
			partial: false,
		})

		assert.equal(result, "The user denied this operation.")
		assert.equal(taskState.didRejectTool, true)
		sinon.assert.calledOnce(callbacks.ask)
		assert.equal(callbacks.ask.firstCall.args[0], "use_subagents")
		sinon.assert.notCalled(runStub)
	})

	it("uses read-file auto-approve level (safe only) for approval bypass", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		sinon.stub(SubagentRunner.prototype, "run").resolves({
			status: "completed",
			result: "done",
			stats: {
				toolCalls: 1,
				inputTokens: 2,
				outputTokens: 3,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.25,
				contextTokens: 5,
				contextWindow: 200000,
				contextUsagePercentage: 0.0025,
			},
		})

		const handler = new UseSubagentsToolHandler()
		await handler.execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "[execution_mode:read_only] one",
			},
			partial: false,
		})

		sinon.assert.notCalled(callbacks.ask)
		const subagentStatusCalls = callbacks.say.getCalls().filter((call) => call.args[0] === "subagent")
		assert.ok(subagentStatusCalls.length >= 1)
	})

	it("requires edit approval once for mutating lane I/O", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", result: "done", stats: emptyStats() })

		await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "[execution_mode:mutation] edit the assigned file" },
			partial: false,
		})

		sinon.assert.calledOnce(callbacks.ask)
		assert.equal(callbacks.ask.firstCall.args[0], "use_subagents")
	})

	it("uses edit auto-approval for a mutating lane without requiring read auto-approval", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: false, autoApproveEdits: true })
		sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", result: "done", stats: emptyStats() })

		await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "[execution_mode:mutation] edit the assigned file" },
			partial: false,
		})

		sinon.assert.notCalled(callbacks.ask)
	})

	it("requires both read and edit auto-approval for a mixed-authority swarm", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: false, autoApproveEdits: true })
		sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", result: "done", stats: emptyStats() })

		await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "[execution_mode:read_only] inspect the assigned file",
				prompt_2: "[execution_mode:mutation] edit the assigned file",
			},
			partial: false,
		})

		sinon.assert.calledOnce(callbacks.ask)
	})

	it("keeps status I/O failures off the execution path and still releases the lease", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true })
		callbacks.say.withArgs("subagent").rejects(new Error("webview unavailable"))
		sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", result: "done", stats: emptyStats() })
		const releaseStub = sinon
			.stub(GovernedSwarmCoordinator.prototype, "releaseSwarmOrchestrationLease")
			.resolves({ released: true })

		const result = await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "one" },
			partial: false,
		})

		assert.match(String(result), /done/)
		assert.ok(releaseStub.callCount >= 1)
	})

	it("fans out prompts in parallel and emits aggregated status", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-handler-"))
		tempDirs.push(tempDir)
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
		let activeRuns = 0
		let maxActiveRuns = 0
		const apiHandlers = new Set<unknown>()

		sinon.stub(SubagentRunner.prototype, "run").callsFake(async function (this: SubagentRunner, _prompt, onProgress) {
			apiHandlers.add((this as unknown as { apiHandler: unknown }).apiHandler)
			activeRuns++
			maxActiveRuns = Math.max(maxActiveRuns, activeRuns)
			onProgress({
				status: "running",
				stats: {
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					contextTokens: 0,
					contextWindow: 200000,
					contextUsagePercentage: 0,
				},
			})
			await delay(10)
			activeRuns--
			return {
				status: "completed",
				result: "done",
				stats: {
					toolCalls: 1,
					inputTokens: 2,
					outputTokens: 3,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0.25,
					contextTokens: 5,
					contextWindow: 200000,
					contextUsagePercentage: 0.0025,
				},
			}
		})

		const handler = new UseSubagentsToolHandler()
		const result = await handler.execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "one",
				prompt_2: "two",
				prompt_3: "three",
			},
			partial: false,
		})

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Total Agents: 3"))
		assert.ok(maxActiveRuns > 1)
		assert.equal(apiHandlers.size, 3, "parallel lanes must not share a mutable API handler")

		const subagentStatusCalls = callbacks.say.getCalls().filter((call) => call.args[0] === "subagent")
		assert.ok(subagentStatusCalls.length >= 2)
		const finalCall = subagentStatusCalls[subagentStatusCalls.length - 1]
		assert.equal(finalCall.args[4], false)
		const finalStatus = JSON.parse(finalCall.args[1])
		const artifact = await loadSwarmEnvelope(config.taskId, finalStatus.swarmId)
		assert.ok(artifact)
		assert.equal(artifact.status, finalStatus.status)
		assert.match(artifact.summaryOverlay || "", /SWARM EXECUTION SUMMARY/)
		assert.equal(artifact.checksum, computeSwarmArtifactChecksum(artifact))

		const usageCalls = callbacks.say.getCalls().filter((call) => call.args[0] === "subagent_usage")
		assert.equal(usageCalls.length, 1)
		const usagePayload = JSON.parse(usageCalls[0].args[1]) as DietCodeSubagentUsageInfo
		assert.equal(usagePayload.source, "subagents")
		assert.equal(usagePayload.tokensIn, 6)
		assert.equal(usagePayload.tokensOut, 9)
		assert.equal(usagePayload.cacheWrites, 0)
		assert.equal(usagePayload.cacheReads, 0)
		assert.equal(usagePayload.cost, 0.75)
	})

	it("does not let child-stream registration block any lane", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		;(config as TaskConfig & { getSessionStreamId: () => string }).getSessionStreamId = () => "parent-stream"
		let slowRegistrationFinished = false
		const startsBeforeSlowRegistration: string[] = []
		sinon.stub(orchestrator, "spawnChildStream").callsFake(async (_parentId, label) => {
			if (label.includes("slow-registration")) {
				await delay(80)
				slowRegistrationFinished = true
			}
			return { id: label } as never
		})
		sinon.stub(orchestrator, "completeStream").resolves()
		sinon.stub(SubagentRunner.prototype, "run").callsFake(async (prompt: string) => {
			if (!slowRegistrationFinished) {
				startsBeforeSlowRegistration.push(prompt)
			}
			return { status: "completed", result: "done", stats: emptyStats() }
		})

		await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "slow-registration", prompt_2: "fast-registration" },
			partial: false,
		})
		await delay(90)

		assert.deepEqual(new Set(startsBeforeSlowRegistration), new Set(["slow-registration", "fast-registration"]))
	})

	it("continues after per-subagent failures and reports both outcomes", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })

		const runStub = sinon.stub(SubagentRunner.prototype, "run").callsFake(async (prompt: string) => {
			if (prompt.includes("fail")) {
				return {
					status: "failed",
					error: "boom",
					stats: {
						toolCalls: 1,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						contextTokens: 0,
						contextWindow: 200000,
						contextUsagePercentage: 0,
					},
				}
			}
			return {
				status: "completed",
				result: "ok",
				stats: {
					toolCalls: 2,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					contextTokens: 0,
					contextWindow: 200000,
					contextUsagePercentage: 0,
				},
			}
		})

		const handler = new UseSubagentsToolHandler()
		const result = await handler.execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "succeed",
				prompt_2: "fail",
			},
			partial: false,
		})

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Success: 1"))
		assert.ok((result as string).includes("Fail: 1"))
		assert.ok((result as string).includes("boom"))
		assert.equal(runStub.callCount, 2, "deterministic failures must not consume retry capacity")
	})

	it("retries transient failures on a fresh runner and accounts for every attempt", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const runnerInstances = new Set<SubagentRunner>()
		let attempts = 0
		sinon.stub(Math, "random").returns(0)
		sinon.stub(SubagentRunner.prototype, "run").callsFake(async function (this: SubagentRunner) {
			runnerInstances.add(this)
			attempts++
			if (attempts === 1) {
				return {
					status: "failed",
					error: "HTTP 429 rate limit exceeded",
					stats: {
						toolCalls: 1,
						inputTokens: 2,
						outputTokens: 1,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0.1,
						contextTokens: 20,
						contextWindow: 200000,
						contextUsagePercentage: 0.01,
					},
				}
			}
			return {
				status: "completed",
				result: "recovered",
				stats: {
					toolCalls: 2,
					inputTokens: 3,
					outputTokens: 2,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0.2,
					contextTokens: 30,
					contextWindow: 200000,
					contextUsagePercentage: 0.015,
				},
			}
		})

		const result = await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "retry transient work" },
			partial: false,
		})

		assert.match(String(result), /recovered/)
		assert.equal(attempts, 2)
		assert.equal(runnerInstances.size, 2)
		const usageCall = callbacks.say.getCalls().find((call) => call.args[0] === "subagent_usage")
		assert.ok(usageCall)
		const usage = JSON.parse(usageCall.args[1]) as DietCodeSubagentUsageInfo
		assert.equal(usage.tokensIn, 5)
		assert.equal(usage.tokensOut, 3)
		assert.ok(Math.abs(usage.cost - 0.3) < Number.EPSILON)
	})

	it("releases execution capacity during retry backoff", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const events: string[] = []
		let retryAttempts = 0
		sinon.stub(Math, "random").returns(1)
		sinon.stub(SubagentRunner.prototype, "run").callsFake(async (prompt: string) => {
			if (prompt === "retry") {
				retryAttempts++
				if (retryAttempts === 1) {
					events.push("retry_backoff")
					return {
						status: "failed",
						error: "HTTP 429 rate limit exceeded",
						stats: { ...emptyStats(), totalCost: 0.01 },
					}
				}
			}
			if (prompt.startsWith("slow")) {
				await delay(80)
				events.push(`${prompt}_finished`)
			}
			if (prompt === "fourth") {
				events.push("fourth_started")
			}
			return { status: "completed", result: "done", stats: emptyStats() }
		})

		await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "retry", prompt_2: "slow-a", prompt_3: "slow-b", prompt_4: "fourth" },
			partial: false,
		})

		assert.ok(events.indexOf("fourth_started") < events.indexOf("slow-a_finished"))
		assert.ok(events.indexOf("fourth_started") < events.indexOf("slow-b_finished"))
	})

	it("fails the crossing lane when the aggregate parent cost budget is exceeded", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		config.taskState.maxCost = 0.15
		sinon.stub(SubagentRunner.prototype, "run").resolves({
			status: "completed",
			result: "done",
			stats: {
				toolCalls: 1,
				inputTokens: 1,
				outputTokens: 1,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.1,
				contextTokens: 2,
				contextWindow: 200000,
				contextUsagePercentage: 0.001,
			},
		})

		const result = await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "one", prompt_2: "two" },
			partial: false,
		})

		assert.match(String(result), /cumulative cost budget exceeded/i)
		assert.match(String(result), /Fail: 1/)
	})

	it("runs configured subagent tools using the prompt parameter", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const handler = new UseSubagentsToolHandler()
		const dynamicToolName = "use_subagent_code_reviewer"
		sinon.stub(AgentConfigLoader, "getInstance").returns({
			resolveSubagentNameForTool: (toolName: string) => (toolName === dynamicToolName ? "code-reviewer" : undefined),
			getCachedConfig: () => undefined,
		} as unknown as AgentConfigLoader)

		const runStub = sinon.stub(SubagentRunner.prototype, "run").resolves({
			status: "completed",
			result: "dynamic done",
			stats: {
				toolCalls: 1,
				inputTokens: 2,
				outputTokens: 3,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.1,
				contextTokens: 100,
				contextWindow: 200000,
				contextUsagePercentage: 0.05,
			},
		})

		const result = await handler.execute(config, {
			type: "tool_use",
			name: dynamicToolName as DietCodeDefaultTool,
			params: { prompt: "review this PR" },
			partial: false,
		})

		assert.match(String(result), /dynamic done/)
		sinon.assert.calledOnce(runStub)
		assert.equal(runStub.firstCall.args[0], "review this PR")
	})

	it("requires prompt for configured subagent tools", async () => {
		const { config, callbacks, taskState } = createConfig()
		const handler = new UseSubagentsToolHandler()
		const dynamicToolName = "use_subagent_code_reviewer"
		sinon.stub(AgentConfigLoader, "getInstance").returns({
			resolveSubagentNameForTool: (toolName: string) => (toolName === dynamicToolName ? "code-reviewer" : undefined),
			getCachedConfig: () => undefined,
		} as unknown as AgentConfigLoader)

		const result = await handler.execute(config, {
			type: "tool_use",
			name: dynamicToolName as DietCodeDefaultTool,
			params: {},
			partial: false,
		})

		assert.equal(result, "missing")
		assert.equal(taskState.consecutiveMistakeCount, 1)
		sinon.assert.calledWithExactly(callbacks.sayAndCreateMissingParamError, DietCodeDefaultTool.USE_SUBAGENTS, "prompt")
	})

	it("propagates failed dependencies without executing downstream lanes", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const executedPrompts: string[] = []
		sinon.stub(SubagentRunner.prototype, "run").callsFake(async (prompt: string) => {
			executedPrompts.push(prompt)
			if (prompt.includes("upstream-fail")) {
				return { status: "failed", error: "upstream boom", stats: emptyStats() }
			}
			return { status: "completed", result: "ok", stats: emptyStats() }
		})

		const result = await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "upstream-fail",
				prompt_2: "[depends_on:0] downstream",
			},
			partial: false,
		})

		assert.equal(executedPrompts.length, 1)
		assert.ok(executedPrompts[0].includes("upstream-fail"))
		assert.match(String(result), /blocked by failed dependencies/)
	})

	it("starts critical-path lanes before lower-priority ready lanes under contention", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const startOrder: string[] = []
		let activeRuns = 0
		let maxActiveRuns = 0

		sinon.stub(SubagentRunner.prototype, "run").callsFake(async (prompt: string) => {
			activeRuns++
			maxActiveRuns = Math.max(maxActiveRuns, activeRuns)
			startOrder.push(prompt)
			await delay(40)
			activeRuns--
			return { status: "completed", result: "done", stats: emptyStats() }
		})

		await new UseSubagentsToolHandler().execute(config, {
			type: "tool_use",
			name: DietCodeDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "leaf-a",
				prompt_2: "leaf-b",
				prompt_3: "leaf-c",
				prompt_4: "[depends_on:2] downstream",
			},
			partial: false,
		})

		assert.ok(maxActiveRuns <= 3)
		assert.ok(startOrder.indexOf("leaf-c") < startOrder.indexOf("leaf-a"))
		assert.ok(startOrder.indexOf("leaf-c") < startOrder.indexOf("leaf-b"))
	})
})
