import type { SkillMetadata } from "@shared/skills"
import { isSkillEnabled } from "@shared/skills"
import { getRoadmapConfig } from "@/services/roadmap/RoadmapConfig"
import { BUNDLED_SKILL_NAME } from "@/services/roadmap/RoadmapSkillInstall"
import { discoverSkills, getAvailableSkills } from "./skills"

const SKILLS_CACHE_TTL_MS = 15_000

type SkillsCacheEntry = {
	skills: SkillMetadata[]
	cachedAt: number
}

const skillsCache = new Map<string, SkillsCacheEntry>()

const cacheMetrics = {
	hits: 0,
	misses: 0,
	lastHit: false,
}

function cacheKey(cwd: string): string {
	return cwd || "__no_workspace__"
}

export function invalidateSkillsCache(cwd?: string): void {
	if (!cwd) {
		skillsCache.clear()
		return
	}
	skillsCache.delete(cacheKey(cwd))
}

export function getSkillsCacheMetrics(): Readonly<{ hits: number; misses: number }> {
	return { hits: cacheMetrics.hits, misses: cacheMetrics.misses }
}

export function resetSkillsCacheMetrics(): void {
	cacheMetrics.hits = 0
	cacheMetrics.misses = 0
	cacheMetrics.lastHit = false
}

export function wasLastSkillsCacheHit(): boolean {
	return cacheMetrics.lastHit
}

export async function getResolvedSkillsForCwd(cwd: string, forceRefresh = false): Promise<SkillMetadata[]> {
	const key = cacheKey(cwd)
	if (!forceRefresh) {
		const cached = skillsCache.get(key)
		if (cached && Date.now() - cached.cachedAt < SKILLS_CACHE_TTL_MS) {
			cacheMetrics.hits++
			cacheMetrics.lastHit = true
			return cached.skills
		}
	}

	cacheMetrics.misses++
	cacheMetrics.lastHit = false

	const allSkills = await discoverSkills(cwd)
	const resolved = getAvailableSkills(allSkills)
	skillsCache.set(key, { skills: resolved, cachedAt: Date.now() })
	return resolved
}

export function filterEnabledSkills(
	skills: SkillMetadata[],
	globalToggles: Record<string, boolean>,
	localToggles: Record<string, boolean>,
): SkillMetadata[] {
	return skills.filter((skill) => isSkillEnabled(skill, globalToggles, localToggles))
}

/**
 * Prompt catalog: exclude bundled roadmap when ROADMAP_STEERING already injects governance.
 */
export function filterPromptSkills(skills: SkillMetadata[]): SkillMetadata[] {
	const roadmapActive = getRoadmapConfig().enabled
	if (!roadmapActive) return skills
	return skills.filter((skill) => !(skill.source === "bundled" && skill.name === BUNDLED_SKILL_NAME))
}

/** Subagents inherit parent toggles but never get bundled roadmap metadata when steering is active. */
export function filterSubagentPromptSkills(skills: SkillMetadata[]): SkillMetadata[] {
	return filterPromptSkills(skills)
}
