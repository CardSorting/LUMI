import * as assert from "assert"
import { describe, it } from "mocha"
import { BUNDLED_SKILL_NAME } from "@/services/roadmap/RoadmapSkillInstall"
import type { SkillMetadata } from "@/shared/skills"
import { BUNDLED_SKILL_URI_PREFIX, isSkillEnabled, skillToggleKey } from "@/shared/skills"
import { filterPromptSkills } from "../skillRuntime"

describe("skillRuntime", () => {
	it("filterPromptSkills excludes bundled roadmap when roadmap is enabled", () => {
		const skills: SkillMetadata[] = [
			{ name: "my-skill", description: "x", path: "/a/SKILL.md", source: "project" },
			{
				name: BUNDLED_SKILL_NAME,
				description: "roadmap",
				path: `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`,
				source: "bundled",
			},
		]
		const filtered = filterPromptSkills(skills)
		assert.strictEqual(filtered.length, 1)
		assert.strictEqual(filtered[0].name, "my-skill")
	})
})

describe("skillToggleKey", () => {
	it("uses stable URI for bundled skills", () => {
		const key = skillToggleKey({
			name: BUNDLED_SKILL_NAME,
			description: "d",
			path: `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`,
			source: "bundled",
		})
		assert.strictEqual(key, `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`)
	})

	it("isSkillEnabled respects bundled URI toggles", () => {
		const skill: SkillMetadata = {
			name: BUNDLED_SKILL_NAME,
			description: "d",
			path: `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`,
			source: "bundled",
		}
		const uriKey = skillToggleKey(skill)
		assert.strictEqual(isSkillEnabled(skill, { [uriKey]: false }, {}), false)
		assert.strictEqual(isSkillEnabled(skill, {}, {}), true)
	})
})
