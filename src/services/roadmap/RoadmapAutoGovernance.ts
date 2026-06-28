/** Shared copy and helpers for internal roadmap governance at attempt_completion. */

export const AUTO_GOVERNANCE = {
	validationAtCompletion: "Schema validation runs automatically at attempt_completion.",
	bootstrapAtCompletion: "Bootstrap autofill runs automatically at attempt_completion.",
	checkpointTouchAtCompletion: "Missing Recent Checkpoint dates are auto-stamped at attempt_completion.",
	writeMutationFollowup: "ROADMAP.md was mutated — validation runs automatically before task completion.",
	editRoadmapResolve: "Edit ROADMAP.md directly to resolve remaining gates, then retry attempt_completion.",
	continueTaskMidPass:
		"Continue the task — roadmap governance (validate, bootstrap autofill, checkpoint date stamp) runs automatically at attempt_completion.",
	autoValidateFailed: "Task completion blocked: ROADMAP.md could not be auto-validated after internal remediation.",
	gatesBlockedPrefix: "Task completion blocked by Roadmap Governance Gates:",
	gateEvaluationFailed:
		"Task completion blocked: roadmap gate evaluation failed internally. Verify ROADMAP.md exists and is readable, then retry attempt_completion.",
	noManualValidate:
		"Do not call roadmap(action='validate') or MCP tools for governance — remediation is internal at attempt_completion.",
	previewBootstrapAutofill: "roadmap(action='apply_bootstrap_fill') — preview only; autofill writes run at attempt_completion.",
	midTaskGovernanceNote:
		"Governance (validate, bootstrap autofill, checkpoint date) runs automatically at attempt_completion — continue the task.",
	/** Machine-readable policy string for all roadmap payloads and preflight XML. */
	governancePolicy:
		"Do not call roadmap(action='validate') or MCP tools for governance — remediation is internal at attempt_completion.",
	roadmapGateRecoveryHint:
		"Edit ROADMAP.md to resolve governance gates — bootstrap fill, validation, and checkpoint date stamp run automatically at attempt_completion.",
	validateDiagnosticOnly:
		"Diagnostic only — governance runs automatically at attempt_completion; continue the task unless ROADMAP.md schema errors need repair.",
} as const

/** Slash commands for optional diagnostics — guide first; never required for governance. */
export const ROADMAP_DIAGNOSTIC_SLASH_COMMANDS = [
	"/roadmap guide",
	"/roadmap explain-gate",
	"/roadmap explain-stale",
	"/roadmap progress --current",
	"/roadmap cockpit",
] as const

/** Stable governance fields for session brief, write hints, and tool envelopes. */
export function governanceFieldsFromStatus(status: {
	auto_clearable_governance_only?: boolean
	validation_pending?: boolean
	governance_mid_task?: string
}): {
	governance_policy: string
	auto_clearable_governance_only: boolean
	governance_mid_task?: string
} {
	const autoClearable = !!status.auto_clearable_governance_only
	return {
		governance_policy: AUTO_GOVERNANCE.governancePolicy,
		auto_clearable_governance_only: autoClearable,
		governance_mid_task:
			status.governance_mid_task ||
			(autoClearable || status.validation_pending ? AUTO_GOVERNANCE.midTaskGovernanceNote : undefined),
	}
}

/** Merge governance fields onto any roadmap payload (progress, watch, steering context). */
export function mergeGovernanceFields<T extends Record<string, unknown>>(
	payload: T,
	source: {
		auto_clearable_governance_only?: boolean
		validation_pending?: boolean
		governance_mid_task?: string
	},
): T & ReturnType<typeof governanceFieldsFromStatus> {
	return { ...payload, ...governanceFieldsFromStatus(source) }
}

/** Brief-level auto-clearable detection for steering surfaces. */
export function isAutoClearableBrief(brief: Record<string, unknown>): boolean {
	if (brief.auto_clearable_governance_only === true) return true
	const gate = (brief.roadmap_gate || {}) as Record<string, unknown>
	const blocking = ((gate.blocking_gates || []) as Array<{ id?: string }>) || []
	return isAutoClearableGovernanceOnly({
		kanbanCompleteAllowed: brief.kanban_complete_allowed as boolean | undefined,
		validationPending: !!brief.validation_pending,
		schemaValid: brief.schema_valid as boolean | null | undefined,
		blockingGates: blocking,
	})
}
export const STALE_AUTO_TOUCH_REASONS = new Set(["no_recent_checkpoint_date", "invalid_date"])

/** Per-gate ROADMAP.md edit instructions for agent recovery (RFC 7807-style extensions). */
export const GATE_EDIT_INSTRUCTIONS: Record<string, string> = {
	roadmap_enabled: "Enable lumi.roadmap.enabled in VS Code settings.",
	workspace_safe: "Open the project workspace root in the editor — not the extension/plugin install tree.",
	roadmap_present: "Create ROADMAP.md at the workspace root (auto-bootstrap may run on session start).",
	workspace_skill_installed:
		"Informational only — bundled auto-rolling-roadmap is a default skill when dietcode.roadmap.auto_install_skills is enabled (default: true). Not a completion gate.",
	schema_valid:
		"Repair ROADMAP.md — ensure all 12 required sections exist, health status is valid, and section 9 audit is present.",
	validation_current: "Usually auto-clears at attempt_completion; if still blocked, fix schema errors in ROADMAP.md.",
	checkpoint_fresh: "Update section 11 (Recent Checkpoint) with today's date and a summary of work completed this pass.",
	bootstrap_complete:
		"Replace remaining bootstrap template phrases with project-specific evidence, or let autofill run at attempt_completion.",
}

export function gateEditInstruction(gateId?: string, fallbackFix?: string): string {
	if (gateId && GATE_EDIT_INSTRUCTIONS[gateId]) {
		return GATE_EDIT_INSTRUCTIONS[gateId]
	}
	return fallbackFix || AUTO_GOVERNANCE.editRoadmapResolve
}

function escapeXmlText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function formatRemediationNote(steps: string[]): string {
	if (steps.length === 0) return ""
	return `\n\nInternal remediation already attempted: ${steps.join("; ")}.`
}

export function formatBlockingGatesList(gates: Array<{ label: string; why: string; fix?: string; id?: string }>): string {
	return gates
		.map((g) => {
			const edit = gateEditInstruction(g.id, g.fix)
			return `- ${g.label}: ${g.why}\n  → Edit: ${edit}`
		})
		.join("\n")
}

export function formatAutoRemediationSummary(steps: string[]): string {
	if (steps.length === 0) return ""
	return `Auto-remediation attempted: ${steps.join("; ")}.`
}

/** True when completion is blocked only by gates cleared at attempt_completion (not schema/content). */
export function isAutoClearableGovernanceOnly(params: {
	kanbanCompleteAllowed?: boolean
	validationPending?: boolean
	schemaValid?: boolean | null
	blockingGates?: Array<{ id?: string }>
}): boolean {
	if (params.kanbanCompleteAllowed !== false) return false
	const blocking = params.blockingGates || []
	const autoClearable = new Set(["validation_current", "bootstrap_complete"])
	if (params.validationPending && blocking.length === 0) {
		return params.schemaValid !== false
	}
	if (blocking.length === 0) return false
	if (params.validationPending && blocking.every((g) => g.id === "validation_current")) {
		return params.schemaValid !== false
	}
	if (blocking.every((g) => g.id && autoClearable.has(g.id))) {
		return blocking.length <= 2
	}
	return false
}

/** Human-readable kanban gate line — info for auto-clearable, hard block otherwise. */
export function formatKanbanGateStatusLine(params: {
	kanbanCompleteAllowed?: boolean
	validationPending?: boolean
	schemaValid?: boolean | null
	blockingGates?: Array<{ id?: string }>
}): string | null {
	if (params.kanbanCompleteAllowed !== false) return null
	if (isAutoClearableGovernanceOnly(params)) {
		return `ℹ️ ${AUTO_GOVERNANCE.midTaskGovernanceNote}`
	}
	return `⛔ attempt_completion blocked — ${AUTO_GOVERNANCE.editRoadmapResolve}`
}

export function journalFollowupForMutation(bootstrapIncomplete?: boolean): string {
	if (bootstrapIncomplete) {
		return `${AUTO_GOVERNANCE.bootstrapAtCompletion} ${AUTO_GOVERNANCE.validationAtCompletion}`
	}
	return AUTO_GOVERNANCE.validationAtCompletion
}

export interface RoadmapGateStructuredInput {
	remediationSteps?: string[]
	blockingGates?: Array<{ id?: string; label: string; why: string; fix?: string }>
	autoClearableOnly?: boolean
}

/** Machine-parseable recovery envelope — mirrors Stripe/GitHub Actions error extensions. */
export function buildRoadmapGateStructuredEnvelope(input: RoadmapGateStructuredInput): string {
	const parts: string[] = ['<roadmap_governance_recovery schema_version="1">']

	parts.push(`<policy>${escapeXmlText(AUTO_GOVERNANCE.governancePolicy)}</policy>`)
	parts.push(
		`<auto_steps>${escapeXmlText(
			[
				AUTO_GOVERNANCE.bootstrapAtCompletion,
				AUTO_GOVERNANCE.validationAtCompletion,
				AUTO_GOVERNANCE.checkpointTouchAtCompletion,
			].join(" "),
		)}</auto_steps>`,
	)

	if (input.autoClearableOnly) {
		parts.push(`<auto_clearable_only>true</auto_clearable_only>`)
		parts.push(`<mid_task_note>${escapeXmlText(AUTO_GOVERNANCE.midTaskGovernanceNote)}</mid_task_note>`)
	}

	if (input.remediationSteps && input.remediationSteps.length > 0) {
		parts.push(`<remediation_attempted>${escapeXmlText(input.remediationSteps.join("; "))}</remediation_attempted>`)
	}

	if (input.blockingGates && input.blockingGates.length > 0) {
		const gateBlocks = input.blockingGates
			.map((g) => {
				const edit = gateEditInstruction(g.id, g.fix)
				return (
					`<gate id="${escapeXmlText(g.id || "unknown")}">` +
					`<label>${escapeXmlText(g.label)}</label>` +
					`<why>${escapeXmlText(g.why)}</why>` +
					`<edit>${escapeXmlText(edit)}</edit>` +
					`</gate>`
				)
			})
			.join("")
		parts.push(`<blocking_gates>${gateBlocks}</blocking_gates>`)
	}

	parts.push(`<resolution>${escapeXmlText(AUTO_GOVERNANCE.editRoadmapResolve)}</resolution>`)
	parts.push("</roadmap_governance_recovery>")
	return parts.join("")
}

/** Mid-task agent_next_call when governance is pending — avoids validate tool loops. */
export function midTaskAgentNextCall(params: {
	validationPending?: boolean
	bootstrapIncomplete?: boolean
	roadmapMissing?: boolean
	fallback?: string
}): string {
	if (params.roadmapMissing) {
		return "roadmap(action='checkpoint') to bootstrap ROADMAP.md"
	}
	if (params.validationPending || params.bootstrapIncomplete) {
		return AUTO_GOVERNANCE.continueTaskMidPass
	}
	return params.fallback || "roadmap(action='guide')"
}
