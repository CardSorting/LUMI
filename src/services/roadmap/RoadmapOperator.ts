import * as path from "path"
import {
	AUTO_GOVERNANCE,
	formatKanbanGateStatusLine,
	isAutoClearableGovernanceOnly,
	ROADMAP_DIAGNOSTIC_SLASH_COMMANDS,
} from "./RoadmapAutoGovernance"
import { REQUIRED_SECTIONS } from "./RoadmapSchema"

export const OPERATOR_PLAYBOOK = `
Auto-rolling roadmap checkpoint (operators)

The roadmap is the project's steering surface — not a backlog or wishlist.

| Your job | Command |
|----------|---------|
| See phase and next step | /roadmap guide or roadmap(action='guide') |
| One-screen operator summary | /roadmap cockpit or roadmap(action='cockpit') (optional diagnostic) |
| Check production health | /roadmap doctor or roadmap(action='doctor') |
| Before major direction changes | roadmap(action='checkpoint') |
| After agent edits ROADMAP.md | validated automatically internally |
| Bootstrap placeholders remain | autofill runs automatically at attempt_completion; preview with roadmap(action='apply_bootstrap_fill') |
| Closed gates / completion blocked | edit ROADMAP.md — gates auto-remediate at attempt_completion |
| Checkpoint outdated vs git activity | /roadmap explain-stale or roadmap(action='explain_stale') |
| Activity timeline | /roadmap progress --timeline |

Write guard: ROADMAP.md only at workspace root — out-of-tree writes blocked at pre_tool_call.
`.trim()

export const AGENT_PLAYBOOK = `
Roadmap autonomous loop (agents)

1. roadmap(action='guide')       — phase, health, steering_line, project_steering_digest, _roadmap_operator_hints
2. roadmap(action='checkpoint')  — evidence bundle + bootstrap_fill_plan when placeholders remain
3. roadmap(action='apply_bootstrap_fill') — preview evidence autofill (writes run at attempt_completion)
4. Edit ROADMAP.md at workspace root only
5. Governance at attempt_completion — bootstrap autofill, schema validation, and checkpoint date stamp run internally
6. roadmap(action='explain_gate') — optional diagnostic when schema issues are unclear
7. roadmap(action='explain_stale') — optional diagnostic when checkpoint freshness vs git activity is unclear
8. Return Required Final Assistant Response summary (not the full file)

Every roadmap tool response includes steering_line and write_guard hints.
Prime directive: did the latest work strengthen or weaken center of gravity?
Section 9 code soup audit is mandatory every pass. Keep Now ≤ 5 items.
`.trim()

export interface GateSnapshot {
	workspace?: string
	roadmap_present?: boolean
	schema_valid?: boolean | null
	kanban_complete_allowed?: boolean
	validation_pending?: boolean
	checkpoint_stale?: boolean
	bootstrap_complete?: boolean
	bootstrap_placeholder_count?: number
	blocking_gates?: Array<{ id?: string; label?: string; why?: string; fix?: string; blocks_kanban_complete?: boolean }>
	workspace_state?: Record<string, unknown>
	roadmap_path?: string
}

export function isBootstrapIncomplete(params: {
	roadmap_exists?: boolean
	bootstrap_complete?: boolean | null
	bootstrap_placeholder_count?: number | null
	workspace_state?: Record<string, unknown>
}): boolean {
	if (!params.roadmap_exists) return false
	const ws = params.workspace_state || {}
	const complete =
		params.bootstrap_complete !== undefined && params.bootstrap_complete !== null
			? params.bootstrap_complete
			: ws.bootstrap_complete
	const count =
		params.bootstrap_placeholder_count !== undefined && params.bootstrap_placeholder_count !== null
			? params.bootstrap_placeholder_count
			: (ws.bootstrap_placeholder_count as number | undefined)
	if (complete === false) return true
	if (complete === true) return false
	return !!(count && count > 0)
}

export function determinePhase(params: {
	roadmap_exists: boolean
	sections_missing: string[]
	health_status: string | null
	validation_valid: boolean | undefined
	bootstrap_incomplete: boolean
}): { phase: string; operator_summary: string; agent_next_call: string; agent_blocked: boolean } {
	if (params.validation_valid === false) {
		return {
			phase: "validate_pending",
			operator_summary: "ROADMAP.md failed schema validation — repair sections; validation runs at attempt_completion.",
			agent_next_call: "roadmap(action='explain_gate') then fix reported issues in ROADMAP.md",
			agent_blocked: false,
		}
	}
	if (!params.roadmap_exists) {
		return {
			phase: "bootstrap",
			operator_summary: "No ROADMAP.md — run a checkpoint pass to create the steering surface.",
			agent_next_call: "roadmap(action='checkpoint') then roadmap(action='template') if needed",
			agent_blocked: false,
		}
	}
	if (params.bootstrap_incomplete) {
		return {
			phase: "bootstrap_fill",
			operator_summary:
				"Bootstrap template phrases remain — autofill runs at attempt_completion; preview with roadmap(action='apply_bootstrap_fill').",
			agent_next_call: AUTO_GOVERNANCE.continueTaskMidPass,
			agent_blocked: false,
		}
	}
	if (params.sections_missing.length > 6) {
		return {
			phase: "structure_repair",
			operator_summary: `ROADMAP.md missing ${params.sections_missing.length} sections — repair schema without losing history.`,
			agent_next_call: "roadmap(action='checkpoint', context='repair schema')",
			agent_blocked: false,
		}
	}
	if (params.health_status && ["Fragmenting", "Overloaded", "Blocked", "Drifting"].includes(params.health_status)) {
		return {
			phase: "coherence_recovery",
			operator_summary: `Roadmap health is ${params.health_status} — run coherence recovery and demote overloaded Now items.`,
			agent_next_call: "roadmap(action='checkpoint', context='coherence recovery')",
			agent_blocked: false,
		}
	}
	return {
		phase: "checkpoint",
		operator_summary: "Roadmap present — checkpoint after meaningful direction or risk changes.",
		agent_next_call: "roadmap(action='checkpoint')",
		agent_blocked: false,
	}
}

export function roadmapToolCommandToSlash(command?: string): string {
	const raw = String(command || "").trim()
	if (!raw) return "/roadmap guide"
	if (raw.startsWith("/roadmap")) return raw

	const actionMatch = /roadmap\(action='([^']+)'(?:,\s*context='([^']*)')?\)/.exec(raw)
	if (!actionMatch) return "/roadmap guide"

	const action = actionMatch[1].replace(/_/g, "-")
	const context = actionMatch[2]?.trim()
	if (context) return `/roadmap ${action} ${context}`
	return `/roadmap ${action}`
}

export function recommendNextAction(params: {
	phase?: string
	roadmap_exists?: boolean
	schema_valid?: boolean | null
	stale?: boolean
	validation_pending?: boolean
	bootstrap_incomplete?: boolean
	last_error?: Record<string, unknown> | null
}): { action: string; command: string; detail: string } {
	if (params.last_error) {
		return {
			action: "run_doctor",
			command: "roadmap(action='last_error')",
			detail: String(params.last_error.operator_action || params.last_error.message || "Review last roadmap error."),
		}
	}
	if (params.validation_pending) {
		return {
			action: "auto_validate",
			command: AUTO_GOVERNANCE.continueTaskMidPass,
			detail: AUTO_GOVERNANCE.continueTaskMidPass,
		}
	}
	if (params.bootstrap_incomplete || params.phase === "bootstrap_fill") {
		return {
			action: "auto_bootstrap_fill",
			command: AUTO_GOVERNANCE.continueTaskMidPass,
			detail: `${AUTO_GOVERNANCE.bootstrapAtCompletion} Optional preview: ${AUTO_GOVERNANCE.previewBootstrapAutofill}`,
		}
	}
	if (!params.roadmap_exists) {
		return {
			action: "bootstrap_roadmap",
			command: "roadmap(action='checkpoint')",
			detail: "ROADMAP.md missing — run a checkpoint pass to create the steering surface.",
		}
	}
	if (params.schema_valid === false) {
		return {
			action: "explain_gate",
			command: "roadmap(action='explain_gate')",
			detail: "Schema gate closed — review closed gates and fix ROADMAP.md; validation runs at attempt_completion.",
		}
	}
	if (params.stale) {
		return {
			action: "explain_stale",
			command: "roadmap(action='explain_stale')",
			detail: "Checkpoint freshness gate closed — review stale signals vs git activity, then refresh checkpoint.",
		}
	}
	if (params.phase === "structure_repair") {
		return {
			action: "repair_schema",
			command: "roadmap(action='checkpoint', context='repair schema')",
			detail: "ROADMAP.md schema incomplete — repair missing sections without losing history.",
		}
	}
	if (params.phase === "coherence_recovery") {
		return {
			action: "coherence_recovery",
			command: "roadmap(action='checkpoint', context='coherence recovery')",
			detail: "Roadmap health degraded — demote overloaded Now items and strengthen section 9 audit.",
		}
	}
	if (params.phase === "validate_pending") {
		return {
			action: "auto_validate",
			command: AUTO_GOVERNANCE.continueTaskMidPass,
			detail: "Schema validation runs automatically at attempt_completion — repair ROADMAP.md if issues remain.",
		}
	}
	if (params.phase === "bootstrap") {
		return {
			action: "run_checkpoint",
			command: "roadmap(action='checkpoint')",
			detail: "Bootstrap ROADMAP.md from gathered evidence.",
		}
	}
	return {
		action: "wait",
		command: "roadmap(action='guide')",
		detail: "Roadmap steering surface current — checkpoint after meaningful direction shifts.",
	}
}

export function gateExplainParamsFromStatus(
	workspace: string,
	gate: Record<string, unknown>,
	status?: Record<string, unknown>,
): {
	workspace: string
	closed_gates: Array<Record<string, unknown>>
	open_gates: string[]
	blocking_gates: Array<Record<string, unknown>>
	kanban_complete_allowed?: boolean
	validation_pending?: boolean
	schema_valid?: boolean | null
} {
	return {
		workspace,
		closed_gates: (gate.closed_gates as Array<Record<string, unknown>>) || [],
		open_gates: (gate.open_gates as string[]) || [],
		blocking_gates: (gate.blocking_gates as Array<Record<string, unknown>>) || [],
		kanban_complete_allowed: gate.kanban_complete_allowed as boolean | undefined,
		validation_pending: !!status?.validation_pending,
		schema_valid: status?.schema_valid as boolean | null | undefined,
	}
}

export function formatExplainGateReport(params: {
	workspace?: string
	closed_gates?: Array<Record<string, unknown>>
	open_gates?: string[]
	blocking_gates?: Array<Record<string, unknown>>
	kanban_complete_allowed?: boolean
	validation?: Record<string, unknown>
	freshness?: Record<string, unknown>
	validation_pending?: boolean
	schema_valid?: boolean | null
}): string {
	const lines = ["🗺️ Roadmap gate explanation", `Workspace: ${params.workspace || "(auto)"}`, ""]

	const closed = params.closed_gates || params.blocking_gates || []
	if (closed.length > 0 || params.open_gates) {
		lines.push(`closed_gates=${closed.length} open_gates=${(params.open_gates || []).length}`)
		if (closed.length > 0) {
			lines.push("")
			for (const item of closed) {
				const mark = item.blocks_kanban_complete ? "⚠️ " : "• "
				lines.push(`${mark}${item.label}: ${item.why}`)
				lines.push(`   fix: ${item.fix}`)
			}
		} else {
			lines.push("✅ All roadmap steering gates open")
		}
		lines.push("")
		const blocking = (params.blocking_gates || params.closed_gates || []) as Array<{ id?: string }>
		const gateLine = formatKanbanGateStatusLine({
			kanbanCompleteAllowed: false,
			validationPending: !!params.validation_pending,
			schemaValid: params.schema_valid,
			blockingGates: blocking,
		})
		if (gateLine) {
			lines.push(gateLine)
		} else if (params.kanban_complete_allowed === true) {
			lines.push("✅ attempt_completion allowed")
		}
		return lines.join("\n")
	}

	if (params.validation) {
		lines.push(`Schema valid: ${params.validation.valid}`)
		const issues = (params.validation.issues as unknown[]) || []
		if (issues.length > 0) {
			lines.push("", "Schema issues:")
			for (const issue of issues.slice(0, 8)) {
				const i = issue as Record<string, unknown>
				lines.push(`  • [${i.severity}] ${i.message}`)
			}
		}
		lines.push("", "Fix: edit ROADMAP.md — validation runs automatically at attempt_completion")
	}

	if (params.freshness) {
		lines.push("", `Checkpoint stale: ${params.freshness.stale}`, `Reason: ${params.freshness.reason}`)
		if (params.freshness.summary) lines.push(String(params.freshness.summary))
	}

	return lines.join("\n")
}

export function buildAgentOperatorHints(params: {
	action?: string
	gate?: GateSnapshot | null
	workspace?: string
	last_error?: Record<string, unknown> | null
	operator_summary?: string
	agent_next_call?: string
	recommended_next_action?: { command?: string; detail?: string }
	project_steering_digest?: Record<string, unknown>
	bootstrap_fill_hint?: string
}): Record<string, unknown> {
	const snap = params.gate || {}
	const wsState = (snap.workspace_state || {}) as Record<string, unknown>
	const bootstrapInc = isBootstrapIncomplete({
		roadmap_exists: !!snap.roadmap_present,
		bootstrap_complete: snap.bootstrap_complete,
		bootstrap_placeholder_count: snap.bootstrap_placeholder_count,
		workspace_state: wsState,
	})
	const workspace = params.workspace || snap.workspace || ""
	const roadmapPath = snap.roadmap_path || (workspace ? path.join(workspace, "ROADMAP.md") : undefined)

	const nextRec =
		params.recommended_next_action ||
		recommendNextAction({
			phase: String(wsState.phase || ""),
			roadmap_exists: !!snap.roadmap_present,
			schema_valid: snap.schema_valid,
			stale: !!snap.checkpoint_stale,
			validation_pending: !!(snap.validation_pending || wsState.validation_pending),
			bootstrap_incomplete: bootstrapInc,
			last_error: params.last_error,
		})

	const digest = params.project_steering_digest || {}
	const hints: Record<string, unknown> = {
		preferred_tool: "roadmap",
		skill: "auto-rolling-roadmap",
		workspace: workspace || undefined,
		roadmap_path: roadmapPath,
		write_guard: roadmapPath
			? `ROADMAP.md lives only at ${roadmapPath}`
			: "ROADMAP.md must be written at the project workspace root",
		kanban_complete_allowed: snap.kanban_complete_allowed,
		validation_pending: !!snap.validation_pending,
		preferred_command: nextRec.command,
		slash_commands: [...ROADMAP_DIAGNOSTIC_SLASH_COMMANDS],
		governance_policy: AUTO_GOVERNANCE.governancePolicy,
		next_action: params.agent_next_call || nextRec.command,
		recovery_suggestion: params.operator_summary || nextRec.detail,
		suggested_slash_command: roadmapToolCommandToSlash(nextRec.command),
		diagnostic_command: "roadmap(action='explain_gate')",
		project_steering_digest: digest,
		project_identity_line: digest.identity_line,
		verification_commands: digest.verification_commands,
	}

	if (params.bootstrap_fill_hint) {
		hints.bootstrap_fill_hint = params.bootstrap_fill_hint
	}

	if (snap.kanban_complete_allowed === false) {
		const blocking = snap.blocking_gates || []
		const autoClearable = isAutoClearableGovernanceOnly({
			kanbanCompleteAllowed: false,
			validationPending: !!(snap.validation_pending || wsState.validation_pending),
			schemaValid: snap.schema_valid,
			blockingGates: blocking as Array<{ id?: string }>,
		})
		hints.auto_clearable_governance_only = autoClearable
		if (autoClearable) {
			hints.governance_mid_task = AUTO_GOVERNANCE.midTaskGovernanceNote
			hints.recovery_suggestion = AUTO_GOVERNANCE.midTaskGovernanceNote
		} else if (blocking.length > 0) {
			hints.missing_gate = blocking[0].id
			hints.recovery_suggestion = blocking[0].fix || hints.recovery_suggestion
		}
	}

	if (params.last_error) {
		hints.retry_command = params.last_error.retry_command
		hints.safe_to_retry = params.last_error.safe_to_retry
	}

	return hints
}

export function wrapClarityEnvelope(
	payload: Record<string, unknown>,
	phaseInfo?: Record<string, unknown>,
): Record<string, unknown> {
	const gate = (payload.roadmap_gate || null) as GateSnapshot | null
	const digest = (payload.project_steering_digest || {}) as Record<string, unknown>
	const operatorHints = buildAgentOperatorHints({
		action: String(payload.action || ""),
		gate,
		workspace: String(payload.workspace || ""),
		last_error: (payload.last_error as Record<string, unknown>) || null,
		operator_summary: String(payload.operator_summary || ""),
		agent_next_call: String(payload.agent_next_call || ""),
		recommended_next_action: payload.recommended_next_action as { command?: string; detail?: string },
		project_steering_digest: digest,
		bootstrap_fill_hint: payload.bootstrap_fill_plan
			? `${(payload.bootstrap_fill_plan as Record<string, unknown>).remaining_count || 0} bootstrap phrase(s) — autofill runs at attempt_completion`
			: undefined,
	})

	const identity =
		payload.project_identity_line || operatorHints.project_identity_line || digest.identity_line || payload.steering_brief

	return {
		...payload,
		...(phaseInfo || {}),
		success: payload.success ?? payload.ok ?? true,
		ok: payload.ok ?? payload.success ?? true,
		execution_path: "roadmap_checkpoint",
		governance_policy: AUTO_GOVERNANCE.governancePolicy,
		auto_clearable_governance_only:
			payload.auto_clearable_governance_only ?? operatorHints.auto_clearable_governance_only ?? false,
		agent_playbook: AGENT_PLAYBOOK,
		operator_playbook: OPERATOR_PLAYBOOK,
		required_section_count: REQUIRED_SECTIONS.length,
		steering_line: payload.steering_line || identity,
		project_identity_line: identity,
		_roadmap_operator_hints: {
			...operatorHints,
			skill_path: payload.skill_path,
			recovery_suggestion: operatorHints.recovery_suggestion || phaseInfo?.operator_summary || payload.operator_summary,
			next_action:
				operatorHints.next_action ||
				(payload.recommended_next_action as Record<string, unknown>)?.command ||
				phaseInfo?.agent_next_call ||
				payload.agent_next_call,
		},
	}
}
