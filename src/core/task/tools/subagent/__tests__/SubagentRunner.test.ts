import { strict as assert } from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import * as coreApi from "@core/api"
import * as skillRuntime from "@core/context/instructions/user-instructions/skillRuntime"
import * as skills from "@core/context/instructions/user-instructions/skills"
import { PromptRegistry } from "@core/prompts/system-prompt"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setRoadmapConfigOverride } from "@/services/roadmap/RoadmapConfig"
import { ApiFormat } from "@/shared/proto/dietcode/models"
import { Logger } from "@/shared/services/Logger"
import { DietCodeDefaultTool } from "@/shared/tools"
import { TaskState } from "../../../TaskState"
import { SubagentBuilder } from "../SubagentBuilder"
import { SubagentRunner } from "../SubagentRunner"
import { SubagentTranscriptRecorder } from "../SubagentTranscriptRecorder"

const VALID_SUBAGENT_COMPLETION_RESULT =
	"Subagent completed the assigned scope successfully. All verification steps passed and the deliverable is ready for review."

function initializeHostProvider() {
	HostProvider.reset()
	HostProvider.initialize(
		() => ({}) as never,
		() => ({}) as never,
		() => ({}) as never,
		() => ({}) as never,
		{
			workspaceClient: {},
			envClient: {
				getHostVersion: async () => ({ platform: "test" }),
			},
			windowClient: {},
			diffClient: {},
		} as never,
		() => undefined,
		async () => "",
		async () => "",
		"",
		"",
	)
}

function createTaskConfig(nativeToolCallEnabled: boolean): TaskConfig {
	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		auditCompletionGateEnabled: false,
		auditCompletionGateThreshold: 50,
		auditCompletionGateCriticalOnly: false,
		auditActModeAdvisoryEnabled: true,
		auditAdvisoryEscalationEnabled: true,
		auditPlanRegressionGateEnabled: true,
		auditToolOutputAdvisoryEnabled: true,
		auditFileWriteAdvisoryEnabled: true,
		auditIntentThresholdAdjustmentsEnabled: true,
		auditIntentThresholdOverrides: "{}",
		auditSarifHookExportEnabled: true,
		auditWorkspaceArtifactsEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		context: {},
		taskState: new TaskState(),
		messageState: {},
		api: {
			getModel: () => ({
				id: "anthropic/claude-sonnet-4.5",
				info: {
					contextWindow: 200_000,
					apiFormat: ApiFormat.ANTHROPIC_CHAT,
					supportsPromptCache: true,
				},
			}),
			createMessage: sinon.stub().callsFake(async function* () {}),
		},
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") {
						return "act"
					}
					if (key === "customPrompt") {
						return undefined
					}
					return undefined
				},
				getGlobalStateKey: (key: string) => (key === "nativeToolCallEnabled" ? nativeToolCallEnabled : undefined),
				getWorkspaceStateKey: (key: string) => undefined,
				getApiConfiguration: () => ({
					actModeApiProvider: "anthropic",
					planModeApiProvider: "anthropic",
				}),
			},
		},
		browserSettings: {},
		focusChainSettings: {},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { executeSafeCommands: false, executeAllCommands: false },
		},
		autoApprover: { shouldAutoApproveTool: sinon.stub().returns([false, false]) },
		callbacks: {
			say: sinon.stub().resolves(undefined),
			ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
			saveCheckpoint: sinon.stub().resolves(),
			sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
			removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
			executeCommandTool: sinon.stub().resolves([false, "ok"]),
			cancelRunningCommandTool: sinon.stub().resolves(false),
			doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
			updateFCListFromToolResponse: sinon.stub().resolves(),
			shouldAutoApproveTool: sinon.stub().returns([true, true]),
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
		},
		coordinator: {
			getHandler: sinon.stub().callsFake((toolName: DietCodeDefaultTool) => {
				if (toolName === DietCodeDefaultTool.LIST_FILES) {
					return {
						execute: sinon.stub().resolves("ok"),
						getDescription: sinon.stub().returns("list_files"),
					}
				}

				return undefined
			}),
		},
	} as unknown as TaskConfig
}

function stubApiHandler(createMessage: sinon.SinonStub) {
	sinon.stub(coreApi, "buildApiHandler").returns({
		abort: sinon.stub(),
		getModel: () => ({
			id: "anthropic/claude-sonnet-4.5",
			info: {
				contextWindow: 200_000,
				apiFormat: ApiFormat.ANTHROPIC_CHAT,
				supportsPromptCache: true,
			},
		}),
		createMessage,
	} as never)
}

describe("SubagentRunner", () => {
	let mockedSkills: any[] = []
	beforeEach(() => {
		mockedSkills = []
		setRoadmapConfigOverride({ enabled: false })
		sinon.stub(skillRuntime, "getResolvedSkillsForCwd").callsFake(async () => mockedSkills)
		sinon.stub(skillRuntime, "filterEnabledSkills").callsFake((discovered) => discovered)
		sinon.stub(skillRuntime, "filterSubagentPromptSkills").callsFake((available) => available)
	})

	afterEach(() => {
		sinon.restore()
		HostProvider.reset()
		setRoadmapConfigOverride(null)
	})

	it("emits native tool_use blocks with matching tool_result tool_use_id across turns", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_1",
						name: DietCodeDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.onSecondCall().callsFake(async function* (_systemPrompt: string, conversation: unknown[]) {
			const assistantMessage = conversation[1] as {
				role: string
				content: Array<{ type?: string; [key: string]: unknown }>
			}
			assert.equal(assistantMessage.role, "assistant")

			const toolUse = assistantMessage.content.find((block) => block.type === "tool_use")
			assert.ok(toolUse)
			assert.equal(toolUse.id, "toolu_subagent_1")
			assert.equal(toolUse.name, DietCodeDefaultTool.LIST_FILES)

			const userMessage = conversation[2] as { role: string; content: Array<{ type?: string; [key: string]: unknown }> }
			assert.equal(userMessage.role, "user")
			const toolResult = userMessage.content.find((block) => block.type === "tool_result")
			assert.ok(toolResult)
			assert.equal(toolResult.tool_use_id, "toolu_subagent_1")

			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_complete_1",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "list_files" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "list_files" }] as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(result.result, VALID_SUBAGENT_COMPLETION_RESULT)
		assert.equal(createMessage.callCount, 2)
	})

	it("publishes terminal completion only after transcript durability and tolerates flush callback failure", async () => {
		const createMessage = sinon.stub().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_durable_completion",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})
		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "attempt_completion" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "attempt_completion" }] as any)
		stubApiHandler(createMessage)
		initializeHostProvider()

		const flush = sinon.stub(SubagentTranscriptRecorder.prototype, "flush").resolves()
		sinon.stub(SubagentTranscriptRecorder.prototype, "init").resolves("/tmp/subagent-durable.transcript.jsonl")
		const callback = sinon.stub().rejects(new Error("status sink unavailable"))
		const config = createTaskConfig(true)
		const runner = new SubagentRunner(config, new SubagentBuilder(config, "subagent"))
		const result = await runner.runWithEnvelope(
			"Complete durably",
			(update) => {
				if (update.status === "completed") assert.ok(flush.callCount >= 2)
			},
			{
				agentId: "agent-durable",
				role: "worker",
				swarmId: "swarm-durable",
				taskId: "task-durable",
				index: 0,
				depth: 0,
				onTranscriptFlush: callback,
			},
		)

		assert.equal(result.status, "completed", result.error)
		assert.ok(result.envelope?.warnings.some((warning) => warning.includes("flush callback failed")))
	})

	it("executes independent I/O authority calls concurrently and projects results in emission order", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			for (const [id, path] of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"].map(
				(path, index) => [`toolu_parallel_${index}`, path] as const,
			)) {
				yield {
					type: "tool_calls",
					tool_call: {
						function: {
							id,
							name: DietCodeDefaultTool.LIST_FILES,
							arguments: JSON.stringify({ path, recursive: false }),
						},
					},
				}
			}
		})
		createMessage.onSecondCall().callsFake(async function* (_systemPrompt: string, conversation: unknown[]) {
			const results = (conversation[2] as { content: Array<{ content?: string }> }).content
			assert.deepEqual(
				results.map((result) => result.content),
				["result:a.ts", "result:b.ts", "result:c.ts", "result:d.ts", "result:e.ts", "result:f.ts"],
			)
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_parallel_complete",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "list_files" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "list_files" }] as any)
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const releases = new Map<string, () => void>()
		const started: string[] = []
		let resolveFirstWaveStarted!: () => void
		const firstWaveStarted = new Promise<void>((resolve) => {
			resolveFirstWaveStarted = resolve
		})
		let resolveAllStarted!: () => void
		const allStarted = new Promise<void>((resolve) => {
			resolveAllStarted = resolve
		})
		config.coordinator.getHandler = sinon.stub().returns({
			execute: sinon.stub().callsFake(async (_config: TaskConfig, block: { params: { path: string } }) => {
				started.push(block.params.path)
				if (started.length === 4) resolveFirstWaveStarted()
				if (started.length === 6) resolveAllStarted()
				await new Promise<void>((resolve) => releases.set(block.params.path, resolve))
				return `result:${block.params.path}`
			}),
			getDescription: sinon.stub().returns("list_files"),
		})
		const runner = new SubagentRunner(config, new SubagentBuilder(config, "subagent"))
		runner.setLaneExecutionMode("read_only")
		const execution = runner.run("Read files", () => {})

		await Promise.race([
			firstWaveStarted,
			delay(500).then(() => {
				throw new Error("bounded I/O batch did not start concurrently")
			}),
		])
		assert.deepEqual(started, ["a.ts", "b.ts", "c.ts", "d.ts"])
		for (const path of started) releases.get(path)?.()
		await Promise.race([
			allStarted,
			delay(500).then(() => {
				throw new Error("queued I/O calls did not start after capacity was released")
			}),
		])
		assert.deepEqual(started, ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"])
		releases.get("e.ts")?.()
		releases.get("f.ts")?.()
		const result = await execution

		assert.equal(result.status, "completed", result.error)
		assert.equal(result.stats.toolCalls, 7)
	})

	it("does not inherit parent focus-chain blockers at lane completion", async () => {
		const createMessage = sinon.stub().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_focus_chain_complete",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "attempt_completion" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "attempt_completion" }] as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		config.focusChainSettings = { enabled: true, remindDietcodeInterval: 6 }
		config.taskState.currentFocusChainChecklist = "- [x] parent setup\n- [ ] parent integration"
		const result = await new SubagentRunner(config, new SubagentBuilder(config, "subagent")).run(
			"Complete an independent lane",
			() => {},
		)

		assert.equal(result.status, "completed", result.error)
		assert.equal(createMessage.callCount, 1)
		assert.equal(config.taskState.completionAttemptCount, undefined)
	})

	it("passes prior request token totals into the next-turn compaction check", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "usage",
				inputTokens: 11,
				outputTokens: 7,
				cacheWriteTokens: 3,
				cacheReadTokens: 2,
			}
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_previous_tokens_1",
						name: DietCodeDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.onSecondCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_previous_tokens_complete_1",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "list_files" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "list_files" }] as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const shouldCompactStub = sinon.stub(runner as any, "shouldCompactBeforeNextRequest").callsFake((...args: unknown[]) => {
			const [previousRequestTotalTokens] = args
			assert.equal(previousRequestTotalTokens, 23)
			return false
		})

		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(result.result, VALID_SUBAGENT_COMPLETION_RESULT)
		assert.equal(createMessage.callCount, 2)
		assert.equal(shouldCompactStub.callCount, 1)
	})

	it("falls back to non-native result blocks if structured tool calls appear while native mode is disabled", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_2",
						name: DietCodeDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.onSecondCall().callsFake(async function* (_systemPrompt: string, conversation: unknown[]) {
			const lastMessage = conversation[conversation.length - 1] as {
				role: string
				content: Array<{ type?: string; [key: string]: unknown }>
			}

			assert.equal(lastMessage.role, "user")
			assert.ok(lastMessage.content.every((block) => block.type === "text"))
			assert.equal(
				lastMessage.content.some((block) => block.type === "tool_result"),
				false,
			)

			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_complete_2",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(result.result, VALID_SUBAGENT_COMPLETION_RESULT)
		assert.equal(createMessage.callCount, 2)
	})

	it("retries empty assistant turns with a no-tools-used nudge before failing", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {})
		createMessage.onSecondCall().callsFake(async function* (_systemPrompt: string, conversation: unknown[]) {
			const lastAssistant = conversation[1] as {
				role: string
				content: Array<{ type?: string; text?: string }>
			}
			assert.equal(lastAssistant.role, "assistant")
			assert.equal(lastAssistant.content[0]?.type, "text")
			assert.equal(lastAssistant.content[0]?.text, "Failure: I did not provide a response.")

			const lastUser = conversation[2] as {
				role: string
				content: Array<{ type?: string; text?: string }>
			}
			assert.equal(lastUser.role, "user")
			assert.equal(lastUser.content[0]?.type, "text")
			assert.match(lastUser.content[0]?.text || "", /You did not use a tool in your previous response/i)

			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_complete_3",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(result.result, VALID_SUBAGENT_COMPLETION_RESULT)
		assert.equal(createMessage.callCount, 2)
	})

	it("retries initial stream failures before failing", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield* []
			throw new Error(
				'{"code":"stream_initialization_failed","message":"Failed to create stream: failed to generate stream from Vercel: failed to send request"}',
			)
		})
		createMessage.onSecondCall().callsFake(async function* () {
			yield* []
			throw new Error(
				'{"code":"stream_initialization_failed","message":"Failed to create stream: failed to generate stream from Vercel: failed to send request"}',
			)
		})
		createMessage.onThirdCall().callsFake(async function* () {
			yield* []
			throw new Error(
				'{"code":"stream_initialization_failed","message":"Failed to create stream: failed to generate stream from Vercel: failed to send request"}',
			)
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "failed")
		assert.equal(createMessage.callCount, 3)
	})

	it("fails context window errors", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield* []
			const contextError = new Error("context length exceeded") as any
			contextError.status = 400
			throw contextError
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("Huge prompt", () => {})

		assert.equal(result.status, "failed")
		assert.equal(createMessage.callCount, 1)
	})

	it("uses the configured task api handler for subagent requests", async () => {
		const createMessage = sinon.stub().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_complete_4",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "list_files" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "list_files" }] as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(createMessage.callCount, 1)
	})

	it("filters available skills to configured skills when subagent skills are configured", async () => {
		const createMessage = sinon.stub().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_skills_filtered_1",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async (context) => {
			assert.ok(context.skills)
			assert.deepEqual(
				context.skills.map((skill) => skill.name),
				["allowed-skill"],
			)
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "getConfiguredSkills").returns(["allowed-skill"])
		mockedSkills = [
			{ name: "allowed-skill", description: "Allowed", path: "/skills/allowed/SKILL.md", source: "project" },
			{ name: "other-skill", description: "Other", path: "/skills/other/SKILL.md", source: "project" },
		]
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("Run task", () => {})
		console.log("SKILL TEST RESULT:", JSON.stringify(result, null, 2))

		assert.equal(result.status, "completed", result.error)
		assert.equal(createMessage.callCount, 1)
	})

	it("uses all available skills when subagent skills are not configured", async () => {
		const createMessage = sinon.stub().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_skills_unconfigured_1",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async (context) => {
			assert.ok(context.skills)
			assert.deepEqual(
				context.skills.map((skill) => skill.name),
				["alpha-skill", "beta-skill"],
			)
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "getConfiguredSkills").returns(undefined)
		mockedSkills = [
			{ name: "alpha-skill", description: "Alpha", path: "/skills/alpha/SKILL.md", source: "project" },
			{ name: "beta-skill", description: "Beta", path: "/skills/beta/SKILL.md", source: "project" },
		]
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("Run task", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(createMessage.callCount, 1)
	})

	it("logs a warning when a configured skill is not available", async () => {
		const createMessage = sinon.stub().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_skills_missing_1",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const warnStub = sinon.stub(Logger, "warn")
		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async (context) => {
			assert.ok(context.skills)
			assert.deepEqual(
				context.skills.map((skill) => skill.name),
				["present-skill"],
			)
			promptRegistry.nativeTools = undefined
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "getConfiguredSkills").returns(["present-skill", "missing-skill"])
		mockedSkills = [{ name: "present-skill", description: "Present", path: "/skills/present/SKILL.md", source: "project" }]
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("Run task", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(createMessage.callCount, 1)
		sinon.assert.calledWith(
			warnStub,
			"[SubagentRunner] Configured skill 'missing-skill' not found or disabled for subagent run.",
		)
	})

	it("includes workspace metadata only in the initial user message", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* (_systemPrompt: string, conversation: unknown[]) {
			const initialUser = conversation[0] as {
				role: string
				content: Array<{ type?: string; text?: string }>
			}
			assert.equal(initialUser.role, "user")
			const initialTexts = initialUser.content
				.filter((block) => block.type === "text")
				.map((block) => block.text || "")
				.join("\n")
			assert.match(initialTexts, /# Workspace Configuration/)

			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_workspace_1",
						name: DietCodeDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.onSecondCall().callsFake(async function* (_systemPrompt: string, conversation: unknown[]) {
			const followUpUser = conversation[2] as {
				role: string
				content: Array<{ type?: string; text?: string }>
			}
			assert.equal(followUpUser.role, "user")
			const followUpTexts = followUpUser.content
				.filter((block) => block.type === "text")
				.map((block) => block.text || "")
				.join("\n")
			assert.equal(followUpTexts.includes("# Workspace Configuration"), false)

			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_workspace_complete_1",
						name: DietCodeDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: VALID_SUBAGENT_COMPLETION_RESULT }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		sinon.stub(promptRegistry, "get").callsFake(async () => {
			promptRegistry.nativeTools = [{ name: "list_files" } as any]
			return "system prompt"
		})
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "list_files" }] as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const config = createTaskConfig(true)
		const builder = new SubagentBuilder(config, "subagent")
		const runner = new SubagentRunner(config, builder)
		const result = await runner.run("List files", () => {})

		assert.equal(result.status, "completed", result.error)
		assert.equal(result.result, VALID_SUBAGENT_COMPLETION_RESULT)
		assert.equal(createMessage.callCount, 2)
	})
})
