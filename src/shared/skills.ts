/**
 * Skill metadata loaded at startup for discovery.
 * Only name and description are parsed from frontmatter initially.
 */
export interface SkillMetadata {
	name: string
	description: string
	path: string
	source: "global" | "project" | "bundled"
}

/**
 * Full skill content loaded on-demand when skill is activated.
 */
export interface SkillContent extends SkillMetadata {
	instructions: string
}

export const BUNDLED_SKILL_URI_PREFIX = "bundled://"

/** Stable toggle key — survives dev/prod path resolution changes for bundled skills. */
export function skillToggleKey(skill: SkillMetadata): string {
	if (skill.source === "bundled") {
		return `${BUNDLED_SKILL_URI_PREFIX}${skill.name}`
	}
	return skill.path
}

export function isSkillEnabled(
	skill: SkillMetadata,
	globalToggles: Record<string, boolean>,
	localToggles: Record<string, boolean>,
): boolean {
	const toggles = skill.source === "project" ? localToggles : globalToggles
	const key = skillToggleKey(skill)
	if (toggles[key] === false) return false
	return true
}

export function telemetrySkillSource(source: SkillMetadata["source"]): "global" | "project" | "bundled" {
	if (source === "bundled") return "bundled"
	if (source === "global") return "global"
	return "project"
}
