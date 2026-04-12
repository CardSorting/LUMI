import { isGPT5ModelFamily, isNextGenModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { CodemarieDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { TEMPLATE_OVERRIDES } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_NEXT_GEN)
	.description("Next gen models with native tool calling")
	.version(1)
	.tags("advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		if (!isNextGenModelProvider(providerInfo)) {
			return false
		}
		const modelId = providerInfo.model.id.toLowerCase()
		return !isGPT5ModelFamily(modelId) && isNextGenModelFamily(modelId)
	})
	.template(TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.JOY_ZONING,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TODO,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		CodemarieDefaultTool.ASK,
		CodemarieDefaultTool.BASH,
		CodemarieDefaultTool.FILE_READ,
		CodemarieDefaultTool.FILE_NEW,
		CodemarieDefaultTool.FILE_EDIT,
		CodemarieDefaultTool.SEARCH,
		CodemarieDefaultTool.LIST_FILES,
		CodemarieDefaultTool.LIST_CODE_DEF,
		CodemarieDefaultTool.BROWSER,
		CodemarieDefaultTool.WEB_FETCH,
		CodemarieDefaultTool.WEB_SEARCH,
		CodemarieDefaultTool.MCP_ACCESS,
		CodemarieDefaultTool.ATTEMPT,
		CodemarieDefaultTool.PLAN_MODE,
		CodemarieDefaultTool.MCP_DOCS,
		CodemarieDefaultTool.TODO,
		CodemarieDefaultTool.GENERATE_EXPLANATION,
		CodemarieDefaultTool.USE_SKILL,
		CodemarieDefaultTool.USE_SUBAGENTS,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.NATIVE_NEXT_GEN,
	})
	.config({})
	// Override the RULES component with custom template
	.overrideComponent(SystemPromptSection.RULES, {
		template: TEMPLATE_OVERRIDES.RULES,
	})
	.overrideComponent(SystemPromptSection.TOOL_USE, {
		template: TEMPLATE_OVERRIDES.TOOL_USE,
	})
	.overrideComponent(SystemPromptSection.OBJECTIVE, {
		template: TEMPLATE_OVERRIDES.OBJECTIVE,
	})
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, {
		template: TEMPLATE_OVERRIDES.ACT_VS_PLAN,
	})
	.overrideComponent(SystemPromptSection.FEEDBACK, {
		template: TEMPLATE_OVERRIDES.FEEDBACK,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_NEXT_GEN }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Native Next Gen variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Native Next Gen variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Native Next Gen variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type NativeNextGenVariantConfig = typeof config
