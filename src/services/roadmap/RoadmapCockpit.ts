import * as path from "path"
import { AUTO_GOVERNANCE, formatKanbanGateStatusLine } from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { formatExplainGateReport, gateExplainParamsFromStatus, recommendNextAction, wrapClarityEnvelope } from "./RoadmapOperator"
import { readCurrentProgress, readLastError } from "./RoadmapProgress"
import type { RoadmapService } from "./RoadmapService"
import { BUNDLED_SKILL_REL } from "./RoadmapSkillInstall"

export function formatCockpitReport(payload: Record<string, unknown>, options?: { agentId?: string; verbose?: boolean }): string {
	const verbose = options?.verbose || process.argv.includes("--verbose")
	const agentId = options?.agentId

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
	if (payload.execution_confidence_score !== undefined) lines.push(`Confidence score: ${payload.execution_confidence_score}`)
	if (payload.orchestration_pressure_score !== undefined) lines.push(`Pressure score: ${payload.orchestration_pressure_score}`)

	const tv = (payload.temporal_validity || (payload.checkpoint_freshness as any)?.temporal_validity) as any
	if (tv) {
		lines.push(`Freshness score: ${tv.freshness_score}/100`)
		lines.push(`Validity window: ${tv.window_start} to ${tv.window_ends} (expired: ${tv.expired})`)
		if (tv.dependency_drift_detected) {
			lines.push(`⚠️ Dependency drift detected: package manifests updated since last validation`)
		}
	}

	if (payload.validation_pending) lines.push(`⚠️ validation_pending — ${AUTO_GOVERNANCE.validationAtCompletion}`)
	if (payload.bootstrap_complete === false) {
		lines.push(`⚠️ bootstrap incomplete (${payload.bootstrap_placeholder_count ?? "?"} phrases)`)
	}

	const gate = (payload.roadmap_gate || {}) as Record<string, unknown>
	const blocking = (gate.blocking_gates as Array<Record<string, unknown>>) || []
	const gateLine = formatKanbanGateStatusLine({
		kanbanCompleteAllowed: gate.kanban_complete_allowed as boolean | undefined,
		validationPending: !!payload.validation_pending,
		schemaValid: payload.schema_valid as boolean | null | undefined,
		blockingGates: blocking as Array<{ id?: string }>,
	})
	if (gateLine) {
		lines.push("", gateLine)
		if (!gateLine.startsWith("ℹ️")) {
			for (const g of blocking.slice(0, 3)) {
				lines.push(`  • ${g.label}: ${g.fix}`)
			}
		}
	}

	lines.push("", `Write guard: ROADMAP.md at ${payload.roadmap_path || "workspace root"}`)
	const verify = ((payload.project_steering_digest as Record<string, unknown>)?.verification_commands as string[]) || []
	if (verify.length > 0) lines.push(`Verify: ${verify[0]}`)

	const runtimeState = (payload.runtime_state ||
		(payload.workspace_state as Record<string, unknown> | undefined)?.runtime_state) as any
	if (runtimeState) {
		lines.push("", "Focus-Scoped Execution Graph (Now):")
		let nowItems = runtimeState.tasks?.now?.items || []
		if (agentId && !verbose) {
			const locks = runtimeState.locks || {}
			nowItems = nowItems.filter((item: any) => {
				const lock = locks[item.id]
				if (lock) {
					const isExpired = new Date(lock.expires_at).getTime() <= Date.now()
					if (!isExpired && lock.owner_agent !== agentId) {
						return false
					}
				}
				return true
			})
		}

		if (nowItems.length > 0) {
			nowItems.forEach((item: any, idx: number) => {
				lines.push(`  [${idx + 1}] ${item.title} (id: ${item.id})`)
			})
		} else {
			lines.push("  • (No active focus items in Now)")
		}

		const anchors = runtimeState.memory?.continuation_anchors || {}
		const anchorKeys = Object.keys(anchors)
		if (anchorKeys.length > 0) {
			lines.push("", "Orchestration Continuation Anchors:")
			anchorKeys.forEach((k) => {
				lines.push(`  • ${k}: ${anchors[k]}`)
			})
		}
	}

	let lineage = (payload.workspace_state as Record<string, unknown> | undefined)?.lineage as Array<any> | undefined
	if (lineage && lineage.length > 0) {
		if (agentId && !verbose) {
			lineage = lineage.filter((entry: any) => !entry.agent_id || entry.agent_id === agentId)
		}
		if (lineage.length > 0) {
			lines.push("", "Steering Lineage Ledger:")
			for (const entry of lineage.slice().reverse()) {
				const time = entry.timestamp.slice(11, 19)
				const tool = entry.tool ? ` [${entry.tool}]` : ""
				const action = entry.action || "mutate"
				const hashStr = entry.hash ? ` (hash: ${entry.hash})` : ""
				const tokenStr = entry.causality_token ? ` (token: ${entry.causality_token})` : ""
				const summary = entry.diff_summary ? ` · ${entry.diff_summary}` : ""
				lines.push(`  • ${time} · ${action}${tool}${hashStr}${tokenStr}${summary}`)
			}
		}
	}

	lines.push(
		"",
		`→ ${(payload.recommended_next_action as Record<string, unknown>)?.command || payload.agent_next_call || "roadmap(action='guide')"}`,
	)
	return lines.join("\n")
}

export async function buildCockpitPayload(
	roadmapService: RoadmapService,
	workspace: string,
	options?: { agentId?: string; verbose?: boolean },
): Promise<Record<string, unknown>> {
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
		skill_path: BUNDLED_SKILL_REL,
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
		agent_next_call: status.agent_next_call || nextRec.command,
		operator_summary: status.operator_summary,
		last_progress: currentProgress,
		last_error: lastError,
		runtime_state: status.runtime_state,
		workspace_state: status.workspace_state,
		report: "",
		gates_report: formatExplainGateReport(gateExplainParamsFromStatus(workspace, gate, status)),
	})

	payload.report = formatCockpitReport(payload, options)
	return payload
}
