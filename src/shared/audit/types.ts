export type HardeningGrade = "A" | "B" | "C" | "D" | "F"
export type IntentClassification = "REFACTOR" | "CREATE" | "FIX" | "INVESTIGATE" | "CONFIGURE" | "DELETE" | "TEST" | "GENERAL"

export type CompletionGateReasonCode =
	| "score_below_threshold"
	| "critical_violations"
	| "policy_violations"
	| "advisory_escalation"
	| "plan_regression"
	| "gate_disabled"

/** Canonical audit metadata shape — single source of truth for extension + orchestrator. */
export interface TaskAuditMetadata {
	joy_zoning_violations?: string[]
	result_checksum?: string
	divergence_detected?: boolean
	entropy_score?: number
	violations?: string[]
	intent_classification?: IntentClassification
	intent_coverage?: number
	hardening_score?: number
	hardening_grade?: HardeningGrade
	audited_at?: number
	/** Set when a completion gate evaluation blocked attempt_completion. */
	gate_blocked?: boolean
	gate_block_count?: number
	gate_reason_codes?: CompletionGateReasonCode[]
	gate_effective_threshold?: number
	/** Relative workspace paths when audit workspace artifacts are persisted. */
	artifact_sarif_path?: string
	artifact_report_path?: string
	artifact_manifest_path?: string
	/** Violations waived via `.audit/suppressions.json`. */
	suppressed_violations?: string[]
	/** True when `.audit/gate-policy.json` overrides extension gate settings. */
	workspace_gate_policy_applied?: boolean
}
