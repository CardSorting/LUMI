import { SystemPromptSection } from "../templates/placeholders"
import { getActVsPlanModeSection } from "./act_vs_plan_mode"
import { getAgentRoleSection } from "./agent_role"
import { getCapabilitiesSection } from "./capabilities"
import { getEditingFilesSection } from "./editing_files"
import { getEnvironmentStateSection } from "./environment_state"
import { getFeedbackSection } from "./feedback"
import { getForensicToolsSection } from "./forensic_tools"
import { getIntegrityDraftingSection } from "./integrity_drafting"
import { getIntegrityWikiSection } from "./integrity_wiki"
import { getJoyZoningSection } from "./joy_zoning"
import { getMcp } from "./mcp"
import { getObjectiveSection } from "./objective"
import { getRoadmapSteeringSection } from "./roadmap_steering"
import { getRulesSection } from "./rules"
import { getSkillsSection } from "./skills"
import { getSystemInfo } from "./system_info"
import { getUpdatingTaskProgress } from "./task_progress"
import { getToolUseSection } from "./tool_use"
import { getUserInstructions } from "./user_instructions"

/**
 * Registers all tool variants with the DietCodeToolSet provider.
 * This function should be called once during application initialization
 * to make all tools available for use.
 */
export function getSystemPromptComponents() {
	return [
		{ id: SystemPromptSection.ACT_VS_PLAN, fn: getActVsPlanModeSection },
		{ id: SystemPromptSection.AGENT_ROLE, fn: getAgentRoleSection },
		{ id: SystemPromptSection.CAPABILITIES, fn: getCapabilitiesSection },
		{ id: SystemPromptSection.EDITING_FILES, fn: getEditingFilesSection },
		{ id: SystemPromptSection.ENVIRONMENT_STATE, fn: getEnvironmentStateSection },
		{ id: SystemPromptSection.FEEDBACK, fn: getFeedbackSection },
		{ id: SystemPromptSection.JOY_ZONING, fn: getJoyZoningSection },
		{ id: SystemPromptSection.ROADMAP_STEERING, fn: getRoadmapSteeringSection },
		{ id: SystemPromptSection.MCP, fn: getMcp },
		{ id: SystemPromptSection.OBJECTIVE, fn: getObjectiveSection },
		{ id: SystemPromptSection.RULES, fn: getRulesSection },
		{ id: SystemPromptSection.SKILLS, fn: getSkillsSection },
		{ id: SystemPromptSection.INTEGRITY_DRAFTING, fn: getIntegrityDraftingSection },
		{ id: SystemPromptSection.INTEGRITY_WIKI, fn: getIntegrityWikiSection },
		{ id: SystemPromptSection.FORENSIC_TOOLS, fn: getForensicToolsSection },
		{ id: SystemPromptSection.SYSTEM_INFO, fn: getSystemInfo },
		{ id: SystemPromptSection.TASK_PROGRESS, fn: getUpdatingTaskProgress },
		{ id: SystemPromptSection.TOOL_USE, fn: getToolUseSection },
		{ id: SystemPromptSection.USER_INSTRUCTIONS, fn: getUserInstructions },
	]
}
