import { strict as assert } from "node:assert"
import * as api from "@core/api"
import { PromptRegistry } from "@core/prompts/system-prompt"
import { CodemarieToolSet } from "@core/prompts/system-prompt/registry/CodemarieToolSet"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { CodemarieDefaultTool } from "@/shared/tools"
import { AgentConfigLoader } from "../AgentConfigLoader"
import { SUBAGENT_DEFAULT_ALLOWED_TOOLS, SUBAGENT_SYSTEM_SUFFIX, SubagentBuilder } from "../SubagentBuilder"

function createTaskConfig(mode: "act" | "plan", provider: string): TaskConfig {
	return {
		ulid: "ulid-123",
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "mode" ? mode : undefined),
				getApiConfiguration: () => ({
					actModeApiProvider: provider,
					planModeApiProvider: provider,
					actModeApiModelId: "act-default",
					planModeApiModelId: "plan-default",
					actModeOpenAiModelId: "openai-act-default",
					planModeOpenRouterModelId: "openrouter-plan-default",
				}),
			},
		},
	} as unknown as TaskConfig
}

describe("SubagentBuilder", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("uses cached config by subagent name and applies act-mode provider model override", () => {
		sinon.stub(AgentConfigLoader, "getInstance").returns({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "cached-agent"
					? {
							name: "cached-agent",
							description: "cached description",
							tools: [CodemarieDefaultTool.LIST_FILES],
							modelId: "gpt-5",
							systemPrompt: "cached system prompt",
						}
					: undefined,
		} as unknown as AgentConfigLoader)

		const fakeHandler = { getModel: sinon.stub(), createMessage: sinon.stub() }
		const buildApiHandlerStub = sinon.stub(api, "buildApiHandler").returns(fakeHandler as never)

		const builder = new SubagentBuilder(createTaskConfig("act", "openai"), "cached-agent")

		assert.equal(buildApiHandlerStub.callCount, 1)
		const [effectiveApiConfig, selectedMode] = buildApiHandlerStub.firstCall.args
		assert.equal(selectedMode, "act")
		assert.equal((effectiveApiConfig as Record<string, unknown>).ulid, "ulid-123")
		assert.equal((effectiveApiConfig as Record<string, unknown>).actModeOpenAiModelId, "gpt-5")
		assert.equal((effectiveApiConfig as Record<string, unknown>).actModeApiModelId, "act-default")

		assert.deepEqual(builder.getAllowedTools(), [CodemarieDefaultTool.LIST_FILES, CodemarieDefaultTool.ATTEMPT])
		const prompt = builder.buildSystemPrompt("generated system prompt")
		assert.match(prompt, /# AGENT PROFILE/)
		assert.match(prompt, /Identity: cached-agent/)
		assert.match(prompt, /Objective: cached description/)
		assert.match(prompt, /cached system prompt/)
		assert.match(prompt, new RegExp(SUBAGENT_SYSTEM_SUFFIX.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
	})

	it("uses defaults when no cached config is provided", () => {
		sinon.stub(AgentConfigLoader, "getInstance").returns({
			getCachedConfig: () => undefined,
		} as unknown as AgentConfigLoader)

		sinon.stub(api, "buildApiHandler").returns({ getModel: sinon.stub(), createMessage: sinon.stub() } as never)
		const builder = new SubagentBuilder(createTaskConfig("act", "anthropic"))

		assert.deepEqual(builder.getAllowedTools(), SUBAGENT_DEFAULT_ALLOWED_TOOLS)
		const prompt = builder.buildSystemPrompt("generated prompt")
		assert.equal(prompt, `generated prompt${SUBAGENT_SYSTEM_SUFFIX}`)
	})

	it("applies plan-mode openrouter model override fields", () => {
		sinon.stub(AgentConfigLoader, "getInstance").returns({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "openrouter-agent"
					? {
							name: "openrouter-agent",
							description: "openrouter plan agent",
							tools: [CodemarieDefaultTool.FILE_READ],
							modelId: "openrouter/custom-model",
							systemPrompt: "plan system",
						}
					: undefined,
		} as unknown as AgentConfigLoader)

		const buildApiHandlerStub = sinon.stub(api, "buildApiHandler").returns({
			getModel: sinon.stub(),
			createMessage: sinon.stub(),
		} as never)

		new SubagentBuilder(createTaskConfig("plan", "openrouter"), "openrouter-agent")

		const [effectiveApiConfig, selectedMode] = buildApiHandlerStub.firstCall.args
		assert.equal(selectedMode, "plan")
		assert.equal((effectiveApiConfig as Record<string, unknown>).planModeOpenRouterModelId, "openrouter/custom-model")
		assert.equal((effectiveApiConfig as Record<string, unknown>).planModeApiModelId, "plan-default")
		assert.equal((effectiveApiConfig as Record<string, unknown>).actModeApiModelId, "act-default")
	})

	it("builds native tools by filtering allowed ids and context requirements then converting", () => {
		sinon.stub(AgentConfigLoader, "getInstance").returns({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "tools-agent"
					? {
							name: "tools-agent",
							description: "tool-limited",
							tools: [CodemarieDefaultTool.LIST_FILES],
							modelId: "sonnet",
							systemPrompt: "tool prompt",
						}
					: undefined,
		} as unknown as AgentConfigLoader)
		sinon.stub(api, "buildApiHandler").returns({ getModel: sinon.stub(), createMessage: sinon.stub() } as never)

		const getModelFamilyStub = sinon.stub(PromptRegistry.getInstance(), "getModelFamily").returns("test-family" as never)
		const getToolsStub = sinon.stub(CodemarieToolSet, "getToolsForVariantWithFallback").returns([
			{
				config: {
					id: CodemarieDefaultTool.LIST_FILES,
					contextRequirements: () => true,
				},
			},
			{
				config: {
					id: CodemarieDefaultTool.SEARCH,
					contextRequirements: () => true,
				},
			},
			{
				config: {
					id: CodemarieDefaultTool.ATTEMPT,
					contextRequirements: () => false,
				},
			},
		] as never)
		const converter = sinon.stub().callsFake((tool: { id: string }) => ({ converted: tool.id }))
		const getConverterStub = sinon.stub(CodemarieToolSet, "getNativeConverter").returns(converter as never)

		const builder = new SubagentBuilder(createTaskConfig("act", "anthropic"), "tools-agent")

		const context = {
			providerInfo: {
				providerId: "anthropic",
				model: { id: "m1" },
			},
		} as never

		const result = builder.buildNativeTools(context)
		assert.equal(getModelFamilyStub.callCount, 1)
		assert.equal(getToolsStub.callCount, 1)
		assert.equal(getConverterStub.callCount, 1)
		assert.deepEqual(result, [{ converted: CodemarieDefaultTool.LIST_FILES }])
	})
})
