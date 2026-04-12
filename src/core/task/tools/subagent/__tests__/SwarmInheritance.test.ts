import { strict as assert } from "node:assert"
import * as coreApi from "@core/api"
import * as skills from "@core/context/instructions/user-instructions/skills"
import { PromptRegistry } from "@core/prompts/system-prompt"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { ApiFormat } from "@/shared/proto/codemarie/models"
import { CodemarieDefaultTool } from "@/shared/tools"
import { TaskState } from "../../../TaskState"
import { SubagentBuilder } from "../SubagentBuilder"
import { SubagentRunner } from "../SubagentRunner"

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
	const taskState = new TaskState()

	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		context: {},
		taskState,
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
					if (key === "mode") return "act"
					return undefined
				},
				getGlobalStateKey: (key: string) => (key === "nativeToolCallEnabled" ? nativeToolCallEnabled : undefined),
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
			postStateToWebview: sinon.stub().resolves(),
			reinitExistingTaskFromId: sinon.stub().resolves(),
			cancelTask: sinon.stub().resolves(),
			updateTaskHistory: sinon.stub().resolves([]),
			applyLatestBrowserSettings: sinon.stub().resolves(undefined),
			switchToActMode: sinon.stub().resolves(false),
			setActiveHookExecution: sinon.stub().resolves(),
			clearActiveHookExecution: sinon.stub().resolves(),
			getActiveHookExecution: sinon.stub().resolves(undefined),
			runUserPromptSubmitHook: sinon.stub().resolves({}),
		},
		coordinator: {
			getHandler: sinon.stub().callsFake((toolName: CodemarieDefaultTool) => {
				if (toolName === CodemarieDefaultTool.ATTEMPT) {
					return {
						execute: sinon.stub().resolves("ok"),
						getDescription: sinon.stub().returns("attempt"),
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

describe("Subagent Swarm Inheritance", () => {
	afterEach(() => {
		sinon.restore()
		HostProvider.reset()
	})

	it("propagates parent context to subagent system prompt context", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_1",
						name: CodemarieDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		const registrySpy = sinon.spy(promptRegistry, "get")

		// biome-ignore lint/suspicious/noExplicitAny: Mocking native tools return type for tests
		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "attempt_completion" }] as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const baseConfig = createTaskConfig(true)
		const builder = new SubagentBuilder(baseConfig, "subagent")
		const runner = new SubagentRunner(baseConfig, builder)
		await runner.run("Verification test", () => {})

		assert.ok(registrySpy.calledOnce)
		const context = registrySpy.firstCall.args[0]
		assert.equal(context.mode, "act")
	})

	it("signals critical findings to parent swarm memory", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_finding_1",
						name: CodemarieDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "CRITICAL: Found a JoyZoning Violation in security.ts" }),
					},
				},
			}
		})

		const baseConfig = createTaskConfig(true)
		// biome-ignore lint/suspicious/noExplicitAny: Accessing internal services for test setup
		;(baseConfig as any).services.stateManager.getGlobalSettingsKey = (key: string) => {
			if (key === "subagentsEnabled") return true
			if (key === "mode") return "act"
			return undefined
		}

		const { orchestrator } = await import("@/infrastructure/ai/Orchestrator")
		const storeMemoryStub = sinon.stub(orchestrator, "storeMemory").resolves()

		stubApiHandler(createMessage)
		initializeHostProvider()

		const builder = new SubagentBuilder(baseConfig, "subagent")
		const runner = new SubagentRunner(baseConfig, builder)
		// Set recursion depth to 0 explicitly to avoid any confusion
		runner.setRecursionDepth(0)
		// biome-ignore lint/suspicious/noExplicitAny: Accessing internal baseConfig for test setup
		;(runner as any).baseConfig.getSessionStreamId = () => "parent-stream-123"

		await runner.run("Audit security", () => {})

		assert.ok(storeMemoryStub.calledOnce, "orchestrator.storeMemory should be called once")
		storeMemoryStub.restore()
	})

	it("enforces recursion guard at depth 3", async () => {
		const baseConfig = createTaskConfig(true)
		// biome-ignore lint/suspicious/noExplicitAny: Accessing internal services for test setup
		;(baseConfig as any).services.stateManager.getGlobalSettingsKey = (key: string) => {
			if (key === "subagentsEnabled") return true
			if (key === "mode") return "act"
			return undefined
		}
		// biome-ignore lint/suspicious/noExplicitAny: Mocking recursion depth for tests
		;(baseConfig as any).recursionDepth = 3

		const { UseSubagentsToolHandler } = await import("../../handlers/SubagentToolHandler")
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(baseConfig, {
			name: CodemarieDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "test" },
			// biome-ignore lint/suspicious/noExplicitAny: Mocking tool call parameters for tests
		} as any)

		// biome-ignore lint/suspicious/noExplicitAny: Accessing content from tool result for verification
		const content = typeof result === "string" ? result : (result as any).content
		assert.ok(content.includes("Swarm Recursion Limit Reached"), `Expected recursion limit message, but got: ${content}`)
	})
})
