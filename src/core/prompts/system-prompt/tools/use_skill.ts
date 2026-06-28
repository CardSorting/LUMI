import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"

const id = DietCodeDefaultTool.USE_SKILL

const generic: DietCodeToolSpec = {
	id,
	variant: ModelFamily.GENERIC,
	name: "use_skill",
	description:
		"Load and activate a skill by name. Skills provide specialized instructions for specific tasks. Use this tool ONCE when a user's request matches one of the available skill descriptions shown in the SKILLS section of your system prompt. After activation, follow the skill's instructions directly - do not call use_skill again.",
	contextRequirements: (context) => context.skills !== undefined && context.skills.length > 0,
	parameters: [
		{
			name: "skill_name",
			required: true,
			instruction: "The name of the skill to activate (must match exactly one of the available skill names)",
		},
		{
			name: "full_reference",
			required: false,
			instruction:
				"Set true only when digest instructions are insufficient and you need the complete SKILL.md reference. Default false — prefer digest.",
		},
	],
}

export const use_skill_variants = [generic]
