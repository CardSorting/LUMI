import { invalidateRoadmapWorkspaceCache } from "./RoadmapCache"
import { getRoadmapConfig } from "./RoadmapConfig"
import { emitProgress } from "./RoadmapProgress"
import { RoadmapService } from "./RoadmapService"
import { sessionBrief } from "./RoadmapSession"
import { isBundledSkillAvailable } from "./RoadmapSkillInstall"

export interface RoadmapSessionInitOptions {
	/** Bootstrap mutates ROADMAP.md and is reserved for explicit lifecycle callers. */
	bootstrap?: boolean
	/** Prefer cached workspace intelligence on admission. */
	forceRefresh?: boolean
}

export async function initRoadmapSession(
	workspace: string,
	taskId?: string,
	options: RoadmapSessionInitOptions = {},
): Promise<Record<string, unknown> | null> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) return null
	const bootstrapEnabled = options.bootstrap ?? true
	const forceRefresh = options.forceRefresh ?? true

	const result: Record<string, unknown> = { workspace, taskId: taskId || null }

	try {
		result.bundled_skill_available = await isBundledSkillAvailable()
	} catch (error) {
		result.skill_install_error = error instanceof Error ? error.message : String(error)
	}

	if (bootstrapEnabled) {
		try {
			const bootstrap = await RoadmapService.getInstance().autoBootstrapIfNeeded(workspace)
			if (bootstrap) {
				result.bootstrap = bootstrap
			}
		} catch (error) {
			result.bootstrap_error = error instanceof Error ? error.message : String(error)
		}
	}

	if (forceRefresh) {
		invalidateRoadmapWorkspaceCache(workspace)
	}
	const brief = await sessionBrief(workspace, forceRefresh)
	result.brief = brief

	await emitProgress("roadmap.session_started", {
		action: "session_start",
		workspace,
		success: brief?.success !== false,
		payload: {
			taskId,
			phase: brief?.phase,
			project_identity_line: brief?.project_identity_line,
			kanban_complete_allowed: brief?.kanban_complete_allowed,
		},
	})

	return result
}

export async function finalizeRoadmapSession(workspace: string, taskId?: string): Promise<void> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) return

	invalidateRoadmapWorkspaceCache(workspace)
	const brief = await sessionBrief(workspace, true)
	await emitProgress("roadmap.session_ended", {
		action: "session_end",
		workspace,
		success: true,
		payload: {
			taskId,
			phase: brief?.phase,
			kanban_complete_allowed: brief?.kanban_complete_allowed,
			validation_pending: brief?.validation_pending,
		},
	})
}
