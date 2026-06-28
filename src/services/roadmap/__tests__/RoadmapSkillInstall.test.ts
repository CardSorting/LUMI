import * as assert from "assert"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { BUNDLED_SKILL_URI_PREFIX } from "@/shared/skills"
import { setRoadmapConfigOverride } from "../RoadmapConfig"
import {
	BUNDLED_SKILL_NAME,
	bundledSkillPath,
	getBundledRoadmapSkillMetadata,
	setRoadmapExtensionRoot,
} from "../RoadmapSkillInstall"

describe("RoadmapSkillInstall", () => {
	let tmpRoot: string

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-skill-install-"))
		setRoadmapConfigOverride({ auto_install_skills: true })
	})

	afterEach(() => {
		setRoadmapConfigOverride(null)
	})

	it("prefers optional-skills canonical path over repo root SKILL.md", async () => {
		setRoadmapExtensionRoot(tmpRoot)
		const canonical = path.join(tmpRoot, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md")
		await fs.mkdir(path.dirname(canonical), { recursive: true })
		await fs.writeFile(canonical, "---\nname: auto-rolling-roadmap\ndescription: canonical\n---\n# Canonical\n", "utf8")
		await fs.writeFile(
			path.join(tmpRoot, "SKILL.md"),
			"---\nname: auto-rolling-roadmap\ndescription: root\n---\n# Root\n",
			"utf8",
		)

		const resolved = await bundledSkillPath()
		assert.strictEqual(resolved, canonical)
	})

	it("falls back to repo root SKILL.md when canonical path missing", async () => {
		setRoadmapExtensionRoot(tmpRoot)
		const rootSkill = path.join(tmpRoot, "SKILL.md")
		await fs.writeFile(rootSkill, "---\nname: auto-rolling-roadmap\ndescription: root\n---\n# Root\n", "utf8")

		const resolved = await bundledSkillPath()
		assert.strictEqual(resolved, rootSkill)
	})

	it("returns stable bundled URI metadata independent of filesystem path", async () => {
		setRoadmapExtensionRoot(tmpRoot)
		const canonical = path.join(tmpRoot, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md")
		await fs.mkdir(path.dirname(canonical), { recursive: true })
		await fs.writeFile(canonical, "---\nname: auto-rolling-roadmap\ndescription: from frontmatter\n---\n# Body\n", "utf8")

		const meta = await getBundledRoadmapSkillMetadata()
		assert.ok(meta)
		assert.strictEqual(meta!.name, BUNDLED_SKILL_NAME)
		assert.strictEqual(meta!.path, `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`)
		assert.strictEqual(meta!.source, "bundled")
		assert.match(meta!.description, /from frontmatter/)
	})
})
