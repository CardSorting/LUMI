export type GateAction =
	| "attempt_completion"
	| "run_finalization"
	| "validate_finalization"
	| "emit_receipt"
	| "seal_session"
	| "abort_corrupt_gate"
	| "run_verification"
	| "act_mode_respond"
	| "ask_followup_question"

export interface GateRecoveryStep {
	order: number
	action: GateAction
	description: string
}
