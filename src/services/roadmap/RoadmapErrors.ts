import { buildAgentOperatorHints } from "./RoadmapOperator"

export interface RoadmapErrorEnvelope {
	ok: false
	success: false
	string_code: string
	error: string
	message: string
	action?: string
	workspace?: string
	safe_to_retry: boolean
	retry_command: string
	diagnostic_command: string
	operator_action: string
	_roadmap_operator_hints: Record<string, unknown>
}

export function errorEnvelope(params: {
	code: string
	message: string
	action?: string
	workspace?: string
	safeToRetry?: boolean
	retryCommand?: string
}): RoadmapErrorEnvelope {
	const retry =
		params.retryCommand ||
		(params.action === "validate"
			? "roadmap(action='validate')"
			: params.action === "checkpoint"
				? "roadmap(action='checkpoint')"
				: "roadmap(action='guide')")

	const hints = buildAgentOperatorHints({
		action: params.action || "guide",
		workspace: params.workspace,
		last_error: {
			message: params.message,
			operator_action: params.message,
			retry_command: retry,
			safe_to_retry: params.safeToRetry ?? true,
		},
	})

	return {
		ok: false,
		success: false,
		string_code: params.code,
		error: params.message,
		message: params.message,
		action: params.action,
		workspace: params.workspace,
		safe_to_retry: params.safeToRetry ?? true,
		retry_command: retry,
		diagnostic_command: "roadmap(action='explain_gate')",
		operator_action: params.message,
		_roadmap_operator_hints: hints,
	}
}
