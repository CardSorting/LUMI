import type { PromptVariant, SystemPromptContext } from "../types"

/**
 * Generate the skills section for the system prompt.
 * Metadata only — instructions load on-demand via use_skill (progressive disclosure).
 */
export async function getSkillsSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	const skills = context.skills
	if (!skills || skills.length === 0) return undefined

	const skillsList = skills.map((skill) => `  - "${skill.name}": ${skill.description}`).join("\n")

	return `SKILLS

Optional specialized workflows. **Do not interrupt the user's task** to load a skill unless the request clearly matches a description below.

Available skills:
${skillsList}

When a skill is needed:
1. Match the request to one description above
2. Call use_skill once with the exact skill name
3. Follow the returned instructions — do not call use_skill again for the same task`
}
