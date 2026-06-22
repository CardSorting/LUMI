import { AUTO_GOVERNANCE } from "./RoadmapAutoGovernance"
import { buildAgentOperatorHints, roadmapToolCommandToSlash } from "./RoadmapOperator"

export interface RoadmapErrorEnvelope {
	ok: false
	success: false
	string_code: string
	error: string
	message: string
	human_message?: string
	action?: string
	workspace?: string
	safe_to_retry: boolean
	retry_command: string
	diagnostic_command: string
	operator_action: string
	suggested_slash_command: string
	_roadmap_error_envelope?: boolean
	_roadmap_operator_hints: Record<string, unknown>
	governance_policy?: string
}

const RECOVERY_BY_CODE: Record<string, string> = {
	roadmap_disabled: "Enable lumi.roadmap.enabled in VS Code settings",
	workspace_unresolved: "Open a workspace folder before using roadmap steering",
	roadmap_missing: "roadmap(action='checkpoint') to bootstrap ROADMAP.md",
	schema_invalid: "Repair ROADMAP.md schema issues — validation runs automatically at completion",
	checkpoint_stale: "Update the Recent Checkpoint section in ROADMAP.md",
	gate_closed: "Edit ROADMAP.md to resolve closed steering gates",
	validation_pending: "Validation runs automatically at completion — repair ROADMAP.md if still blocked",
	unknown_action: "roadmap(action='guide') for phase and next call",
}

function recoveryForCode(code: string, action: string): string {
	return RECOVERY_BY_CODE[code] || `roadmap(action='${action || "guide"}')`
}

function diagnosticForCode(code: string): string {
	if (code === "checkpoint_stale") return "/roadmap explain-stale"
	if (["gate_closed", "schema_invalid", "validation_pending"].includes(code)) {
		return "/roadmap explain-gate"
	}
	return "/roadmap doctor"
}

export function errorEnvelope(params: {
	code: string
	message: string
	action?: string
	workspace?: string
	safeToRetry?: boolean
	retryCommand?: string
	detail?: string
	phase?: string
}): RoadmapErrorEnvelope {
	const action = params.action || "guide"
	const retry =
		params.retryCommand ||
		(action === "validate"
			? "roadmap(action='explain_gate')"
			: action === "checkpoint"
				? "roadmap(action='checkpoint')"
				: recoveryForCode(params.code, action))

	const operatorAction = recoveryForCode(params.code, action)
	const diagnostic = diagnosticForCode(params.code)
	const slash = roadmapToolCommandToSlash(retry)

	const hints = buildAgentOperatorHints({
		action,
		workspace: params.workspace,
		last_error: {
			message: params.message,
			operator_action: operatorAction,
			retry_command: retry,
			safe_to_retry: params.safeToRetry ?? true,
		},
	})

	const cleanHints: Record<string, any> = {
		preferred_tool: hints.preferred_tool,
		skill: hints.skill,
		governance_policy: hints.governance_policy,
		next_action: hints.next_action || retry,
		recovery_suggestion: hints.recovery_suggestion || params.message,
		suggested_slash_command: slash.startsWith("/roadmap") ? slash : "/roadmap guide",
	}
	if (hints.workspace) cleanHints.workspace = hints.workspace
	if (hints.roadmap_path) cleanHints.roadmap_path = hints.roadmap_path
	if (hints.write_guard) cleanHints.write_guard = hints.write_guard
	if (hints.retry_command) cleanHints.retry_command = hints.retry_command
	if (hints.safe_to_retry !== undefined) cleanHints.safe_to_retry = hints.safe_to_retry

	return {
		ok: false,
		success: false,
		string_code: params.code,
		error: params.message,
		message: params.message,
		human_message: params.message,
		action,
		workspace: params.workspace,
		safe_to_retry: params.safeToRetry ?? true,
		retry_command: retry,
		diagnostic_command: diagnostic,
		operator_action: operatorAction,
		suggested_slash_command: slash.startsWith("/roadmap") ? slash : "/roadmap guide",
		governance_policy: AUTO_GOVERNANCE.governancePolicy,
		_roadmap_error_envelope: true,
		_roadmap_operator_hints: cleanHints,
	}
}

export function gateClosedEnvelope(message: string, action = "explain_gate"): RoadmapErrorEnvelope {
	return errorEnvelope({
		code: "gate_closed",
		message,
		action,
		phase: "gate.blocked",
	})
}

export function validationPendingEnvelope(workspace = ""): RoadmapErrorEnvelope {
	return errorEnvelope({
		code: "validation_pending",
		message: AUTO_GOVERNANCE.continueTaskMidPass,
		action: "guide",
		workspace,
		retryCommand: AUTO_GOVERNANCE.continueTaskMidPass,
	})
}

export function fromException(error: unknown, action = ""): RoadmapErrorEnvelope {
	const message = error instanceof Error ? error.message : String(error)
	return errorEnvelope({
		code: "roadmap_failed",
		message,
		action: action || "guide",
		detail: error instanceof Error ? error.name : undefined,
	})
}
