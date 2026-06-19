import * as path from "path"
import { AUTO_GOVERNANCE } from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { formatExplainGateReport, recommendNextAction, wrapClarityEnvelope } from "./RoadmapOperator"
import { readCurrentProgress, readLastError } from "./RoadmapProgress"
import type { RoadmapService } from "./RoadmapService"
import { WORKSPACE_SKILL_REL } from "./RoadmapSkillInstall"

export function formatCockpitReport(payload: Record<string, unknown>): string {
	const lines = [
		"🗺️ Roadmap cockpit",
		`Workspace: ${payload.workspace || "(auto)"}`,
		`Project: ${payload.project_identity_line || payload.steering_brief || "unknown"}`,
		"",
	]

	if (payload.health_status) lines.push(`Health: ${payload.health_status}`)
	if (payload.phase) lines.push(`Phase: ${payload.phase}`)
	if (payload.recent_checkpoint_date) lines.push(`Last checkpoint: ${payload.recent_checkpoint_date}`)
	if (payload.code_soup_risk) lines.push(`Code soup risk: ${payload.code_soup_risk}`)
	if (payload.now_item_count !== undefined) lines.push(`Now items: ${payload.now_item_count}`)
	if (payload.validation_pending) lines.push(`⚠️ validation_pending — ${AUTO_GOVERNANCE.validationAtCompletion}`)
	if (payload.bootstrap_complete === false) {
		lines.push(`⚠️ bootstrap incomplete (${payload.bootstrap_placeholder_count ?? "?"} phrases)`)
	}

	const gate = (payload.roadmap_gate || {}) as Record<string, unknown>
	if (gate.kanban_complete_allowed === false) {
		lines.push("", "⛔ attempt_completion blocked")
		const blocking = (gate.blocking_gates as Array<Record<string, unknown>>) || []
		for (const g of blocking.slice(0, 3)) {
			lines.push(`  • ${g.label}: ${g.fix}`)
		}
	}

	lines.push("", `Write guard: ROADMAP.md at ${payload.roadmap_path || "workspace root"}`)
	const verify = ((payload.project_steering_digest as Record<string, unknown>)?.verification_commands as string[]) || []
	if (verify.length > 0) lines.push(`Verify: ${verify[0]}`)
	lines.push(
		"",
		`→ ${(payload.recommended_next_action as Record<string, unknown>)?.command || payload.agent_next_call || "roadmap(action='guide')"}`,
	)
	return lines.join("\n")
}

export async function buildCockpitPayload(roadmapService: RoadmapService, workspace: string): Promise<Record<string, unknown>> {
	const cfg = getRoadmapConfig()
	const status = await roadmapService.getOperationalStatus(workspace, "", "standard")
	const gate = (status.roadmap_gate || {}) as Record<string, unknown>
	const lastError = await readLastError()
	const currentProgress = await readCurrentProgress()

	const nextRec =
		(status.recommended_next_action as { command?: string; detail?: string }) ||
		recommendNextAction({
			phase: String(status.phase || ""),
			roadmap_exists: !!status.roadmap_exists,
			schema_valid: status.schema_valid,
			stale: !!gate.checkpoint_stale,
			validation_pending: !!status.validation_pending,
			bootstrap_incomplete: status.bootstrap_complete === false,
			last_error: lastError,
		})

	const payload = wrapClarityEnvelope({
		action: "cockpit",
		cockpit: true,
		success: true,
		ok: true,
		generated_at: new Date().toISOString(),
		enabled: cfg.enabled,
		workspace,
		roadmap_path: path.join(workspace, "ROADMAP.md"),
		skill_path: WORKSPACE_SKILL_REL,
		roadmap_exists: status.roadmap_exists,
		health_status: status.health_status,
		code_soup_risk: status.code_soup_risk,
		recent_checkpoint_date: status.recent_checkpoint_date,
		now_item_count: status.now_item_count,
		schema_valid: status.schema_valid,
		validation_pending: status.validation_pending,
		bootstrap_complete: status.bootstrap_complete,
		bootstrap_placeholder_count: status.bootstrap_placeholder_count,
		phase: status.phase,
		steering_brief: status.steering_brief,
		stack_summary: status.stack_summary,
		project_archetype: status.project_archetype,
		project_identity_line: status.project_identity_line,
		project_steering_digest: status.project_steering_digest,
		roadmap_gate: gate,
		kanban_complete_allowed: status.kanban_complete_allowed,
		checkpoint_freshness: status.checkpoint_freshness,
		recommended_next_action: nextRec,
		agent_next_call: nextRec.command,
		operator_summary: status.operator_summary,
		last_progress: currentProgress,
		last_error: lastError,
		report: "",
		gates_report: formatExplainGateReport({
			workspace,
			closed_gates: (gate.closed_gates as Array<Record<string, unknown>>) || [],
			open_gates: (gate.open_gates as string[]) || [],
			blocking_gates: (gate.blocking_gates as Array<Record<string, unknown>>) || [],
			kanban_complete_allowed: gate.kanban_complete_allowed as boolean,
		}),
	})

	payload.report = formatCockpitReport(payload)
	return payload
}
