/** SonarQube / ESLint-style severity tiers for policy violations. */
export type ViolationSeverity = "critical" | "warning" | "info"

const CRITICAL_VIOLATIONS = new Set([
	"result_empty",
	"reported_blocker",
	"missing_validation_evidence",
	"security_leak",
	"stalled_task_timeout",
])

const WARNING_PREFIXES = ["unresolved_work_marker:", "low_intent_coverage:", "high_entropy_low_coverage:"]

export function getViolationSeverity(violation: string): ViolationSeverity {
	if (CRITICAL_VIOLATIONS.has(violation)) {
		return "critical"
	}
	if (WARNING_PREFIXES.some((prefix) => violation.startsWith(prefix))) {
		return "warning"
	}
	if (violation === "result_too_short") {
		return "warning"
	}
	return "info"
}

export function partitionViolationsBySeverity(violations: string[] = []): {
	critical: string[]
	warning: string[]
	info: string[]
} {
	const critical: string[] = []
	const warning: string[] = []
	const info: string[] = []
	for (const violation of violations) {
		const severity = getViolationSeverity(violation)
		if (severity === "critical") critical.push(violation)
		else if (severity === "warning") warning.push(violation)
		else info.push(violation)
	}
	return { critical, warning, info }
}

export function hasCriticalViolations(violations: string[] = []): boolean {
	return violations.some((v) => getViolationSeverity(v) === "critical")
}
