const REMEDIATION_HINTS: Record<string, string> = {
	result_empty: "Provide a substantive completion summary describing what was done.",
	missing_validation_evidence: "Include explicit verification evidence (tests run, build output, lint results).",
	reported_blocker: "Resolve the reported blocker or document why it cannot be completed.",
	security_leak: "Remove sensitive data from the completion result before finishing.",
	result_too_short: "Expand the result to cover the scope of the original task.",
	stalled_task_timeout: "Investigate why the task stalled and retry with a complete result.",
	verification_output_failure: "Fix failing verification commands (tests, lint, build) before completing.",
}

export function getViolationRemediation(violation: string): string | undefined {
	if (REMEDIATION_HINTS[violation]) {
		return REMEDIATION_HINTS[violation]
	}
	if (violation.startsWith("unresolved_work_marker:")) {
		return "Remove or resolve all TODO/FIXME/placeholder markers before completing."
	}
	if (violation.startsWith("low_intent_coverage:")) {
		return "Ensure the result addresses the terms and goals stated in the original task."
	}
	if (violation.startsWith("high_entropy_low_coverage:")) {
		return "Reduce scope drift: align the result more closely with the stated intent."
	}
	return undefined
}
