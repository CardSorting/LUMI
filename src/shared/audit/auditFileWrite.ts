const VERIFICATION_FAILURE_PATTERNS: RegExp[] = [
	/\b(fail(?:ed|ures?)?|FAILED)\b.*\b(test|tests|suite|spec)\b/i,
	/\b(test|tests|suite|spec)\b.*\b(fail(?:ed|ures?)?|FAILED)\b/i,
	/\b\d+\s+failed\b/i,
	/\bTests:\s*\d+\s+failed\b/i,
	/\bAssertionError\b/,
	/\bexpect\(.*\)\.(?:toBe|toEqual|toMatch)/i,
	/\berror TS\d+\b/i,
	/\bELIFECYCLE\b.*\bCommand failed\b/i,
	/\bnpm ERR!/i,
	/\b(exit code|exit status)\s*[1-9]\d*\b/i,
]

export function detectVerificationOutputFailures(output: string): string[] {
	if (!output.trim()) {
		return []
	}
	const violations: string[] = []
	for (const pattern of VERIFICATION_FAILURE_PATTERNS) {
		if (pattern.test(output)) {
			violations.push("verification_output_failure")
			break
		}
	}
	return violations
}

const FILE_CONTENT_MARKER_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
	{ pattern: /\bTODO\b/i, signal: "unresolved_work_marker:todo" },
	{ pattern: /\bFIXME\b/i, signal: "unresolved_work_marker:fixme" },
	{ pattern: /\bXXX\b/i, signal: "unresolved_work_marker:xxx" },
	{ pattern: /\bHACK\b/i, signal: "unresolved_work_marker:hack" },
	{ pattern: /\bnot implemented\b/i, signal: "unresolved_work_marker:not_implemented" },
	{ pattern: /\bplaceholder\b/i, signal: "unresolved_work_marker:placeholder" },
]

export function detectFileContentAuditSignals(content: string): string[] {
	const signals: string[] = []
	for (const { pattern, signal } of FILE_CONTENT_MARKER_PATTERNS) {
		if (pattern.test(content)) {
			signals.push(signal)
		}
	}
	return [...new Set(signals)].slice(0, 4)
}

export function buildFileWriteContentAdvisory(content: string, relPath: string): string {
	const signals = detectFileContentAuditSignals(content)
	if (signals.length === 0) {
		return ""
	}
	const labels = signals.map((s) => s.replace(/^unresolved_work_marker:/, "")).join(", ")
	return (
		`\n\n<file_write_audit_advisory path="${relPath}">` +
		`\nWritten content contains unresolved markers: ${labels}.` +
		`\nResolve before attempt_completion.` +
		`\n</file_write_audit_advisory>`
	)
}
