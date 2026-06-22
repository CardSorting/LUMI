/**
 * Unified workspace steering context — mirrors dietcode steering_context.py.
 * One bundle for agents, operators, and progress snapshots.
 */
import * as path from "path"
import { governanceFieldsFromStatus, midTaskAgentNextCall } from "./RoadmapAutoGovernance"
import { recommendNextAction } from "./RoadmapOperator"
import { RoadmapService } from "./RoadmapService"

const STEERING_PAYLOAD_KEYS = [
	"workspace",
	"workspace_source",
	"roadmap_path",
	"roadmap_exists",
	"workspace_safe",
	"bootstrap_complete",
	"bootstrap_placeholder_count",
	"health_status",
	"code_soup_risk",
	"recent_checkpoint_date",
	"center_of_gravity_excerpt",
	"now_item_count",
	"project_name",
	"package_name",
	"readme_tagline",
	"package_description",
	"stack_summary",
	"steering_identity",
	"steering_brief",
	"project_archetype",
	"primary_language",
	"frameworks",
	"ci_systems",
	"test_frameworks",
	"monorepo_tools",
	"package_managers",
	"has_ci",
	"has_tests",
	"has_docker",
	"purpose_hint",
	"runtime_center_hint",
	"operators_hint",
	"entry_points",
	"license",
	"git_remote",
	"docs_roots",
	"agent_rules_files",
	"makefile_targets",
	"verification_commands",
	"runtime_versions",
	"has_codeowners",
	"dependency_automation",
	"compose_services",
	"governance_files",
	"workspace_packages",
	"ci_workflow_names",
	"has_pre_commit",
	"has_backstage_catalog",
	"catalog_name",
	"catalog_description",
] as const

export async function buildSteeringContext(workspace: string): Promise<Record<string, unknown>> {
	const ws = path.resolve(workspace)
	const roadmapPath = path.join(ws, "ROADMAP.md")
	const status = await RoadmapService.getInstance().getOperationalStatus(ws, "", "light")
	const fp = (status.project_fingerprint || {}) as Record<string, unknown>
	const digest = (status.project_steering_digest || {}) as Record<string, unknown>
	const gate = (status.roadmap_gate || {}) as Record<string, unknown>

	let agentNextCall = midTaskAgentNextCall({
		validationPending: !!status.validation_pending,
		bootstrapIncomplete: status.bootstrap_complete === false && !!status.roadmap_exists,
		roadmapMissing: !status.roadmap_exists,
		fallback: String(status.agent_next_call || "roadmap(action='guide')"),
	})
	if (!status.roadmap_exists) {
		agentNextCall = recommendNextAction({ roadmap_exists: false }).command
	}

	return {
		ok: true,
		workspace: ws,
		workspace_source: "explicit",
		roadmap_path: roadmapPath,
		roadmap_exists: !!status.roadmap_exists,
		workspace_safe: true,
		bootstrap_complete: status.bootstrap_complete,
		bootstrap_placeholder_count: status.bootstrap_placeholder_count,
		health_status: status.health_status,
		code_soup_risk: status.code_soup_risk,
		recent_checkpoint_date: status.recent_checkpoint_date,
		now_item_count: status.now_item_count,
		center_of_gravity_excerpt: digest.center_of_gravity_excerpt,
		project_identity_line: status.project_identity_line,
		project_steering_digest: digest,
		project_fingerprint: fp,
		roadmap_gate: gate,
		kanban_complete_allowed: status.kanban_complete_allowed,
		validation_pending: status.validation_pending,
		phase: status.phase,
		agent_next_call: agentNextCall,
		recommended_next_action: status.recommended_next_action,
		...governanceFieldsFromStatus({
			auto_clearable_governance_only: !!status.auto_clearable_governance_only,
			validation_pending: !!status.validation_pending,
		}),
		...fp,
	}
}

export function mergeSteeringFields(
	payload: Record<string, unknown>,
	steering: Record<string, unknown>,
): Record<string, unknown> {
	const out = { ...payload }
	if (steering.workspace && !out.workspace) out.workspace = steering.workspace
	for (const key of STEERING_PAYLOAD_KEYS) {
		if (steering[key] != null && out[key] == null) {
			out[key] = steering[key]
		}
	}
	if (steering.roadmap_path && !out.roadmap_path) out.roadmap_path = steering.roadmap_path
	if (steering.project_steering_digest && !out.project_steering_digest) {
		out.project_steering_digest = steering.project_steering_digest
	}
	if (steering.project_fingerprint && !out.project_fingerprint) {
		out.project_fingerprint = steering.project_fingerprint
	}
	if (steering.project_identity_line && !out.project_identity_line) {
		out.project_identity_line = steering.project_identity_line
	}
	if (steering.agent_next_call && !out.agent_next_call) {
		out.agent_next_call = steering.agent_next_call
	}
	if (steering.recommended_next_action && !out.recommended_next_action) {
		out.recommended_next_action = steering.recommended_next_action
	}
	if (steering.phase && !out.phase) out.phase = steering.phase
	return out
}

export async function enrichPayloadWithSteering(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
	const explicit = String(payload.workspace || "").trim()
	if (!explicit) return payload
	const steering = await buildSteeringContext(explicit)
	return mergeSteeringFields(payload, steering)
}
