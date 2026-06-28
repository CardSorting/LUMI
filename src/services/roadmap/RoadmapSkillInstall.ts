import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import type { SkillMetadata } from "@shared/skills"
import { BUNDLED_SKILL_URI_PREFIX } from "@shared/skills"
import * as fs from "fs/promises"
import * as path from "path"
import { getRoadmapConfig } from "./RoadmapConfig"

export const BUNDLED_SKILL_NAME = "auto-rolling-roadmap"
export const BUNDLED_SKILL_DESCRIPTION =
	"Maintain ROADMAP.md as the project's living product, architecture, and long-horizon development checkpoint. Use when steering project direction, updating roadmap checkpoints, or resolving code soup drift."

/** Relative path shown in operator payloads (bundled with the extension, not copied per workspace). */
export const BUNDLED_SKILL_REL = "SKILL.md"

/** @deprecated Bundled skill is no longer copied into workspaces. Use BUNDLED_SKILL_REL. */
export const WORKSPACE_SKILL_REL = BUNDLED_SKILL_REL

let extensionRoot: string | null = null

/** Called once from extension activate — stable bundled skill resolution in production. */
export function setRoadmapExtensionRoot(root: string): void {
	extensionRoot = path.resolve(root)
}

function bundledSkillCandidates(): string[] {
	const candidates: string[] = []
	if (extensionRoot) {
		candidates.push(path.join(extensionRoot, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md"))
		candidates.push(path.join(extensionRoot, "SKILL.md"))
	}
	const roots = [
		process.cwd(),
		path.resolve(process.cwd(), ".."),
		path.resolve(__dirname, "..", "..", ".."),
		path.resolve(__dirname, "..", "..", "..", ".."),
	]
	for (const root of roots) {
		candidates.push(path.join(root, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md"))
		candidates.push(path.join(root, "SKILL.md"))
	}
	return [...new Set(candidates)]
}

export async function bundledSkillPath(): Promise<string> {
	for (const candidate of bundledSkillCandidates()) {
		try {
			await fs.access(candidate)
			return candidate
		} catch {}
	}
	return bundledSkillCandidates()[0]
}

export async function isBundledSkillAvailable(): Promise<boolean> {
	if (!getRoadmapConfig().auto_install_skills) {
		return false
	}
	try {
		await fs.access(await bundledSkillPath())
		return true
	} catch {
		return false
	}
}

/** @deprecated Use isBundledSkillAvailable — skill is bundled, not workspace-installed. */
export async function isWorkspaceSkillInstalled(_workspace?: string): Promise<boolean> {
	return isBundledSkillAvailable()
}

export async function getBundledRoadmapSkillMetadata(): Promise<SkillMetadata | null> {
	if (!getRoadmapConfig().auto_install_skills) {
		return null
	}

	let skillPath: string
	try {
		skillPath = await bundledSkillPath()
		await fs.access(skillPath)
	} catch {
		return null
	}

	let description = BUNDLED_SKILL_DESCRIPTION
	try {
		const fh = await fs.open(skillPath, "r")
		const buf = Buffer.alloc(2048)
		await fh.read(buf, 0, 2048, 0)
		await fh.close()
		const { data: frontmatter } = parseYamlFrontmatter(buf.toString("utf-8"))
		if (typeof frontmatter.description === "string" && frontmatter.description.trim()) {
			description = frontmatter.description.trim()
		}
	} catch {}

	return {
		name: BUNDLED_SKILL_NAME,
		description,
		path: `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`,
		source: "bundled",
	}
}

export async function ensurePrimarySkill(_workspace: string): Promise<{ available: boolean }> {
	return { available: await isBundledSkillAvailable() }
}
