import * as path from "path"
import { formatRoadmapSteeringBlock } from "./RoadmapAgentSteering"
import { governanceFieldsFromStatus } from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { RoadmapService } from "./RoadmapService"
import { WORKSPACE_SKILL_REL } from "./RoadmapSkillInstall"

interface BriefCacheEntry {
	brief: Record<string, unknown>
	cachedAt: number
}

const briefCache = new Map<string, BriefCacheEntry>()

function cacheKey(workspace: string): string {
	return path.resolve(workspace)
}

export function invalidateSessionBriefCache(workspace?: string): void {
	if (!workspace) {
		briefCache.clear()
		return
	}
	briefCache.delete(cacheKey(workspace))
}

export async function sessionBrief(workspace: string, forceRefresh = false): Promise<Record<string, unknown> | null> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) {
		return null
	}

	const key = cacheKey(workspace)
	if (!forceRefresh) {
		const cached = briefCache.get(key)
		if (cached && Date.now() - cached.cachedAt < cfg.session_brief_cache_ttl_seconds * 1000) {
			return { ...cached.brief }
		}
	}

	try {
		const status = await RoadmapService.getInstance().getOperationalStatus(workspace, "", "light")
		const gate = (status.roadmap_gate || {}) as Record<string, unknown>
		const nextRec = (status.recommended_next_action || {}) as Record<string, unknown>
		const hints = (status._roadmap_operator_hints || {}) as Record<string, unknown>

		const brief: Record<string, unknown> = {
			enabled: true,
			success: true,
			workspace,
			roadmap_path: path.join(workspace, "ROADMAP.md"),
			skill_path: WORKSPACE_SKILL_REL,
			phase: status.phase,
			roadmap_exists: status.roadmap_exists,
			health_status: status.health_status,
			code_soup_risk: status.code_soup_risk,
			schema_valid: status.schema_valid,
			validation_pending: status.validation_pending,
			bootstrap_complete: status.bootstrap_complete,
			bootstrap_placeholder_count: status.bootstrap_placeholder_count,
			recent_checkpoint_date: status.recent_checkpoint_date,
			now_item_count: status.now_item_count,
			last_validated_at: (status.workspace_state as Record<string, unknown>)?.last_validated_at,
			last_mutated_at: (status.workspace_state as Record<string, unknown>)?.last_mutated_at,
			steering_brief: status.steering_brief,
			stack_summary: status.stack_summary,
			project_archetype: status.project_archetype,
			project_fingerprint: status.project_fingerprint,
			project_identity_line: status.project_identity_line,
			project_steering_digest: status.project_steering_digest,
			steering_line: status.steering_line || status.project_identity_line,
			operator_summary: status.operator_summary,
			agent_next_call: status.agent_next_call || nextRec.command || "roadmap(action='guide')",
			recommended_next_action: status.recommended_next_action,
			roadmap_gate: gate,
			kanban_complete_allowed: status.kanban_complete_allowed,
			...governanceFieldsFromStatus({
				auto_clearable_governance_only: !!status.auto_clearable_governance_only,
				validation_pending: !!status.validation_pending,
				governance_mid_task: hints.governance_mid_task as string | undefined,
			}),
			first_call: nextRec.command || status.agent_next_call || "roadmap(action='guide')",
			prime_directive: status.prime_directive,
			agent_playbook: status.agent_playbook,
			operator_playbook: status.operator_playbook,
			_roadmap_operator_hints: hints,
		}

		briefCache.set(key, { brief, cachedAt: Date.now() })
		return { ...brief }
	} catch (error) {
		return {
			enabled: cfg.enabled,
			success: false,
			error: error instanceof Error ? error.message : String(error),
			first_call: "roadmap(action='guide')",
			agent_next_call: "roadmap(action='guide')",
		}
	}
}

export function formatRoadmapEnvironmentSection(brief: Record<string, unknown>): string {
	return formatRoadmapSteeringBlock(brief)
}

export async function getRoadmapEnvironmentSection(workspace: string): Promise<string> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) {
		return ""
	}
	const brief = await sessionBrief(workspace)
	if (!brief || brief.success === false) {
		return ""
	}
	return `\n\n${formatRoadmapEnvironmentSection(brief)}`
}
