import { getResolvedSkillsForCwd, invalidateSkillsCache } from "@core/context/instructions/user-instructions/skills"
import type { IController as Controller } from "@core/controller/types"
import { RefreshedSkills, SkillInfo } from "@shared/proto/dietcode/file"
import { isSkillEnabled, skillToggleKey } from "@shared/skills"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Refreshes all skill toggles (discovers skills and their enabled state)
 */
export async function refreshSkills(controller: Controller): Promise<RefreshedSkills> {
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const primaryWorkspace = workspacePaths.paths[0] || ""

	const allSkills = await getResolvedSkillsForCwd(primaryWorkspace)
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	const localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}

	const globalSkills: SkillInfo[] = []
	const localSkills: SkillInfo[] = []

	for (const skill of allSkills) {
		const info = SkillInfo.create({
			name: skill.name,
			description: skill.description,
			path: skillToggleKey(skill),
			enabled: isSkillEnabled(skill, globalToggles, localToggles),
		})
		if (skill.source === "project") {
			localSkills.push(info)
		} else {
			globalSkills.push(info)
		}
	}

	return RefreshedSkills.create({
		globalSkills,
		localSkills,
	})
}

/** Invalidate discovery cache after skill mutations from the controller layer. */
export function invalidateSkillsCacheForWorkspace(_controller: Controller): void {
	void HostProvider.workspace.getWorkspacePaths({}).then((workspacePaths) => {
		invalidateSkillsCache(workspacePaths.paths[0])
	})
}
