import { getSkillsDirectoriesForScan } from "@core/storage/disk"
import { GOLDEN_CARTRIDGE_SKILL_NAME } from "@shared/golden-cartridge"
import type { SkillContent, SkillMetadata } from "@shared/skills"
import { BUNDLED_SKILL_URI_PREFIX } from "@shared/skills"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import * as fs from "fs/promises"
import * as path from "path"
import { getRoadmapConfig } from "@/services/roadmap/RoadmapConfig"
import { BUNDLED_SKILL_NAME, bundledSkillPath, getBundledRoadmapSkillMetadata } from "@/services/roadmap/RoadmapSkillInstall"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"
import { ROADMAP_SKILL_EXECUTION_DIGEST } from "./roadmapSkillDigest"

const GOLDEN_CARTRIDGE_SKILL_DESCRIPTION =
	"Apply an explicit scarcity budget to development work. Enable this optional preference when you want minimal repository reads, mutations, abstractions, dependencies, delegation, and validation cost."

export {
	filterEnabledSkills,
	filterPromptSkills,
	filterSubagentPromptSkills,
	getResolvedSkillsForCwd,
	getSkillsCacheMetrics,
	invalidateSkillsCache,
	resetSkillsCacheMetrics,
	wasLastSkillsCacheHit,
} from "./skillRuntime"

/** Parse YAML frontmatter from markdown content (shared helper). */
function parseFrontmatter(fileContent: string): { data: Record<string, unknown>; content: string } {
	const result = parseYamlFrontmatter(fileContent)
	if (result.parseError) {
		Logger.warn("Failed to parse YAML frontmatter:", result.parseError)
	}
	return { data: result.data, content: result.body }
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md files.
 */
async function scanSkillsDirectory(dirPath: string, source: "global" | "project"): Promise<SkillMetadata[]> {
	const skills: SkillMetadata[] = []

	if (!(await fileExistsAtPath(dirPath)) || !(await isDirectory(dirPath))) {
		return skills
	}

	try {
		const entries = await fs.readdir(dirPath)

		for (const entryName of entries) {
			const entryPath = path.join(dirPath, entryName)
			const stats = await fs.stat(entryPath).catch(() => null)
			if (!stats?.isDirectory()) continue

			const skill = await loadSkillMetadata(entryPath, source, entryName)
			if (skill) {
				skills.push(skill)
			}
		}
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EACCES") {
			Logger.warn(`Permission denied reading skills directory: ${dirPath}`)
		}
	}

	return skills
}

/**
 * Load skill metadata from a skill directory.
 */
async function loadSkillMetadata(
	skillDir: string,
	source: "global" | "project",
	skillName: string,
): Promise<SkillMetadata | null> {
	const skillMdPath = path.join(skillDir, "SKILL.md")
	if (!(await fileExistsAtPath(skillMdPath))) return null

	try {
		const fileContent = await fs.readFile(skillMdPath, "utf-8")
		const { data: frontmatter } = parseFrontmatter(fileContent)

		// Validate required fields
		if (!frontmatter.name || typeof frontmatter.name !== "string") {
			Logger.warn(`Skill at ${skillDir} missing required 'name' field`)
			return null
		}
		if (!frontmatter.description || typeof frontmatter.description !== "string") {
			Logger.warn(`Skill at ${skillDir} missing required 'description' field`)
			return null
		}

		// Name must match directory name per spec
		if (frontmatter.name !== skillName) {
			Logger.warn(`Skill name "${frontmatter.name}" doesn't match directory "${skillName}"`)
			return null
		}

		return {
			name: skillName,
			description: frontmatter.description,
			path: skillMdPath,
			source,
		}
	} catch (error) {
		Logger.warn(`Failed to load skill at ${skillDir}:`, error)
		return null
	}
}

/**
 * Discover all skills from global (~/.dietcode/skills) and project directories.
 * Returns skills in order: project skills first, then global skills.
 * Global skills take precedence over project skills with the same name.
 */
export async function discoverSkills(cwd: string, includeOptionalBundled = false): Promise<SkillMetadata[]> {
	const skills: SkillMetadata[] = []

	const scanDirs = getSkillsDirectoriesForScan(cwd)

	for (const dir of scanDirs) {
		const dirSkills = await scanSkillsDirectory(dir.path, dir.source)
		skills.push(...dirSkills)
	}

	const bundledSkill = await getBundledRoadmapSkillMetadata()
	if (bundledSkill) {
		skills.push(bundledSkill)
	}

	if (includeOptionalBundled && getRoadmapConfig().auto_install_skills) {
		try {
			await fs.access(await bundledSkillPath(GOLDEN_CARTRIDGE_SKILL_NAME))
			skills.push({
				name: GOLDEN_CARTRIDGE_SKILL_NAME,
				description: GOLDEN_CARTRIDGE_SKILL_DESCRIPTION,
				path: `${BUNDLED_SKILL_URI_PREFIX}${GOLDEN_CARTRIDGE_SKILL_NAME}`,
				source: "bundled",
				defaultEnabled: false,
			})
		} catch {}
	}

	return skills
}

/**
 * Get available skills with override resolution (bundled > global > project).
 */
export function getAvailableSkills(skills: SkillMetadata[]): SkillMetadata[] {
	const seen = new Set<string>()
	const result: SkillMetadata[] = []

	// Iterate backwards: global skills (added last) are seen first and take precedence
	for (let i = skills.length - 1; i >= 0; i--) {
		const skill = skills[i]
		if (!seen.has(skill.name)) {
			seen.add(skill.name)
			result.unshift(skill)
		}
	}

	return result
}

export type SkillLoadMode = "digest" | "full"

export interface SkillLoadOptions {
	mode?: SkillLoadMode
}

/**
 * Load skill instructions. Bundled roadmap defaults to digest (never full SKILL.md on hot path).
 */
export async function getSkillContent(
	skillName: string,
	availableSkills: SkillMetadata[],
	options: SkillLoadOptions = {},
): Promise<SkillContent | null> {
	const skill = availableSkills.find((s) => s.name === skillName)
	if (!skill) return null

	const loadMode = options.mode ?? "digest"
	const isBundledRoadmap = skill.source === "bundled" && skill.name === BUNDLED_SKILL_NAME && getRoadmapConfig().enabled

	if (isBundledRoadmap && loadMode === "digest") {
		return {
			...skill,
			instructions: ROADMAP_SKILL_EXECUTION_DIGEST,
		}
	}

	try {
		const readPath = skill.path.startsWith(BUNDLED_SKILL_URI_PREFIX) ? await bundledSkillPath(skill.name) : skill.path
		const fileContent = await fs.readFile(readPath, "utf-8")
		const { content: body } = parseFrontmatter(fileContent)

		return {
			...skill,
			instructions: body.trim(),
		}
	} catch {
		return null
	}
}
