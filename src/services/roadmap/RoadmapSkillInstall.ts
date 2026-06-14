import * as fs from "fs/promises"
import * as path from "path"
import { getRoadmapConfig } from "./RoadmapConfig"

export const WORKSPACE_SKILL_REL = "optional-skills/dietcode/auto-rolling-roadmap/SKILL.md"

let extensionRoot: string | null = null

/** Called once from extension activate — stable bundled skill resolution in production. */
export function setRoadmapExtensionRoot(root: string): void {
	extensionRoot = path.resolve(root)
}

function bundledSkillCandidates(): string[] {
	const candidates: string[] = []
	if (extensionRoot) {
		candidates.push(path.join(extensionRoot, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md"))
	}
	const roots = [
		process.cwd(),
		path.resolve(process.cwd(), ".."),
		path.resolve(__dirname, "..", "..", ".."),
		path.resolve(__dirname, "..", "..", "..", ".."),
	]
	for (const root of roots) {
		candidates.push(path.join(root, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md"))
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

export function workspaceSkillPath(workspace: string): string {
	return path.join(workspace, WORKSPACE_SKILL_REL)
}

export async function ensurePrimarySkill(workspace: string): Promise<{ installed: string[]; skipped: boolean }> {
	const cfg = getRoadmapConfig()
	if (!cfg.auto_install_skills) {
		return { installed: [], skipped: true }
	}

	const dest = workspaceSkillPath(workspace)
	try {
		await fs.access(dest)
		return { installed: [], skipped: false }
	} catch {
		// continue to install
	}

	const source = await bundledSkillPath()
	try {
		await fs.access(source)
	} catch {
		return { installed: [], skipped: false }
	}

	await fs.mkdir(path.dirname(dest), { recursive: true })
	await fs.copyFile(source, dest)
	return { installed: [WORKSPACE_SKILL_REL], skipped: false }
}

export async function isWorkspaceSkillInstalled(workspace: string): Promise<boolean> {
	try {
		await fs.access(workspaceSkillPath(workspace))
		return true
	} catch {
		return false
	}
}
