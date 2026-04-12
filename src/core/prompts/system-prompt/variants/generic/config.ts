import {
	isGLMModelFamily,
	isLocalModel,
	isNextGenModelFamily,
	isNextGenModelProvider,
	isTrinityModelFamily,
} from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { CodemarieDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.GENERIC)
	.description("The fallback prompt for generic use cases and models.")
	.version(1)
	.tags("fallback", "stable")
	.labels({
		stable: 1,
		fallback: 1,
	})
	// Generic matcher - fallback for everything that doesn't match other variants
	// This will match anything that doesn't match the other specific variants
	.matcher((context) => {
		const providerInfo = context.providerInfo
		if (!providerInfo.providerId || !providerInfo.model.id) {
			return true
		}
		const modelId = providerInfo.model.id.toLowerCase()
		return (
			// Not a local model with compact prompt enabled
			!(providerInfo.customPrompt === "compact" && isLocalModel(providerInfo)) &&
			// Not a next-gen model
			!(isNextGenModelProvider(providerInfo) && isNextGenModelFamily(modelId)) &&
			// Not a GLM model
			!isGLMModelFamily(modelId) &&
			// Not a Trinity model
			!isTrinityModelFamily(modelId)
		)
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.JOY_ZONING,
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.MCP,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		CodemarieDefaultTool.BASH,
		CodemarieDefaultTool.FILE_READ,
		CodemarieDefaultTool.FILE_NEW,
		CodemarieDefaultTool.FILE_EDIT,
		CodemarieDefaultTool.SEARCH,
		CodemarieDefaultTool.LIST_FILES,
		CodemarieDefaultTool.LIST_CODE_DEF,
		CodemarieDefaultTool.BROWSER,
		CodemarieDefaultTool.MCP_USE,
		CodemarieDefaultTool.MCP_ACCESS,
		CodemarieDefaultTool.ASK,
		CodemarieDefaultTool.ATTEMPT,
		CodemarieDefaultTool.PLAN_MODE,
		CodemarieDefaultTool.MCP_DOCS,
		CodemarieDefaultTool.TODO,
		CodemarieDefaultTool.GENERATE_EXPLANATION,
		CodemarieDefaultTool.USE_SKILL,
		CodemarieDefaultTool.USE_SUBAGENTS,
	)
	.placeholders({
		MODEL_FAMILY: "generic",
	})
	.config({})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "generic" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Generic variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid generic variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Generic variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GenericVariantConfig = typeof config
