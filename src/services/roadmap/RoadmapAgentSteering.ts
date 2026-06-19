/** Live agent steering — compact entity-card lines for prompts and environment_details (Backstage-style). */

import { AUTO_GOVERNANCE } from "./RoadmapAutoGovernance"

function truncate(text: string, limit = 120): string {
	const stripped = text.split(/\s+/).filter(Boolean).join(" ")
	if (stripped.length <= limit) return stripped
	return `${stripped.slice(0, limit - 1)}…`
}

export function buildProjectContextLines(brief: Record<string, unknown>): string[] {
	const lines: string[] = []
	const digest = (brief.project_steering_digest || {}) as Record<string, unknown>
	const fp = (brief.project_fingerprint || digest || {}) as Record<string, unknown>

	const identity = brief.project_identity_line || brief.steering_line || brief.steering_brief || fp.steering_brief
	if (identity) lines.push(`Project: ${identity}`)

	const stack = brief.stack_summary || fp.stack_summary
	const archetype = brief.project_archetype || fp.project_archetype
	if (stack && !String(identity || "").includes(String(stack))) {
		const stackLine =
			archetype && archetype !== "project" ? `Stack: ${stack} (${String(archetype).replace(/-/g, " ")})` : `Stack: ${stack}`
		lines.push(stackLine)
	} else if (archetype && archetype !== "project") {
		lines.push(`Archetype: ${String(archetype).replace(/-/g, " ")}`)
	}

	const tagline = fp.readme_tagline || fp.purpose_hint || fp.package_description
	if (tagline && !String(identity || "").includes(String(tagline))) {
		lines.push(`Purpose: ${truncate(String(tagline), 140)}`)
	}

	const agentRules = (fp.agent_rules_files as string[]) || (digest.agent_rules_files as string[]) || []
	if (agentRules.length > 0) lines.push(`Agent rules: ${agentRules.slice(0, 3).join(", ")}`)

	const makeTargets = (fp.makefile_targets as string[]) || (digest.makefile_targets as string[]) || []
	if (makeTargets.length > 0) lines.push(`Makefile: ${makeTargets.slice(0, 4).join(", ")}`)

	const verify = (fp.verification_commands as string[]) || (digest.verification_commands as string[]) || []
	if (verify.length > 0) lines.push(`Verify: ${verify.slice(0, 3).join(", ")}`)

	const governance = (fp.governance_files as string[]) || (digest.governance_files as string[]) || []
	if (governance.length > 0) lines.push(`Governance: ${governance.slice(0, 3).join(", ")}`)

	const ci = (fp.ci_systems as string[]) || (digest.ci_systems as string[]) || []
	if (ci.length > 0) lines.push(`CI: ${ci.slice(0, 2).join(", ")}`)

	const quality = (fp.quality_tools as string[]) || (digest.quality_tools as string[]) || []
	if (quality.length > 0) lines.push(`Quality: ${quality.slice(0, 3).join(", ")}`)

	if (fp.has_backstage_catalog || digest.has_backstage_catalog) {
		lines.push("Backstage: catalog-info.yaml present")
	}

	const statusBits: string[] = []
	if (brief.health_status) statusBits.push(`health=${brief.health_status}`)
	if (brief.now_item_count != null) statusBits.push(`Now=${brief.now_item_count}`)
	if (brief.code_soup_risk) statusBits.push(`soup=${brief.code_soup_risk}`)
	if (statusBits.length > 0) lines.push(`Roadmap: ${statusBits.join(", ")}`)

	if (brief.recent_checkpoint_date) {
		lines.push(`Last checkpoint: ${brief.recent_checkpoint_date}`)
	} else if (brief.roadmap_exists) {
		lines.push("Last checkpoint: unparsed — auto-stamped at attempt_completion if section 11 exists")
	}

	return lines
}

export function formatRoadmapSteeringBlock(brief: Record<string, unknown>): string {
	const lines = ["# Roadmap Steering", ...buildProjectContextLines(brief)]

	if (brief.phase) lines.push(`Phase: ${brief.phase}`)
	if (brief.kanban_complete_allowed === false) {
		lines.push(`⛔ attempt_completion blocked — ${AUTO_GOVERNANCE.editRoadmapResolve}`)
	}
	if (brief.validation_pending) {
		lines.push(`⚠️ ROADMAP.md changed since last validate — ${AUTO_GOVERNANCE.validationAtCompletion}`)
	}
	if (brief.bootstrap_complete === false) {
		lines.push(
			`⚠️ Bootstrap incomplete (${brief.bootstrap_placeholder_count ?? "?"} template phrase(s)) — ${AUTO_GOVERNANCE.bootstrapAtCompletion}`,
		)
	}
	if (brief.operator_summary) lines.push(`Summary: ${brief.operator_summary}`)
	if (brief.agent_next_call) lines.push(`Next: ${brief.agent_next_call}`)

	const hints = brief._roadmap_operator_hints as Record<string, unknown> | undefined
	const verifyCmds = (hints?.verification_commands as string[]) || []
	if (verifyCmds.length > 0) lines.push(`Verify: ${verifyCmds[0]}`)

	lines.push("Prime directive: Did the latest work strengthen or weaken the project's center of gravity?")
	return lines.join("\n")
}

export function formatWatchSteeringLine(brief: Record<string, unknown>): string {
	const identity = brief.project_identity_line || brief.steering_brief || "project"
	const phase = brief.phase || "unknown"
	const next = brief.agent_next_call || "roadmap(action='guide')"
	const gate = brief.kanban_complete_allowed === false ? " ⛔gates" : ""
	const pending = brief.validation_pending ? " ⚠️pending" : ""
	return `[roadmap] ${identity} · phase=${phase}${gate}${pending} → ${next}`
}
