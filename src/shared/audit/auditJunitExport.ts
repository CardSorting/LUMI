import { formatGateReasonLabel } from "./auditGateCatalog"
import type { CompletionGateDecision } from "./auditGateReport"
import { formatViolationLabel } from "./taskAuditUtils"
import type { TaskAuditMetadata } from "./types"

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

/** JUnit XML export — compatible with Jenkins, Azure DevOps, GitLab test reports. */
export function buildAuditJunitXml(
	metadata: TaskAuditMetadata,
	options?: { taskId?: string; gateDecision?: CompletionGateDecision },
): string {
	const taskId = options?.taskId ?? "task-audit"
	const violations = metadata.violations ?? []
	const suppressed = metadata.suppressed_violations ?? []
	const gateFailures = (options?.gateDecision?.reasons ?? [])
		.filter((reason) => reason.code !== "gate_disabled")
		.map((reason) => ({
			name: formatGateReasonLabel(reason.code),
			message: reason.message,
		}))

	const testcaseCount = Math.max(1, violations.length + gateFailures.length + suppressed.length)
	const failureCount = violations.length + gateFailures.length
	const skippedCount = suppressed.length
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<testsuites name="DietCode Task Audit" tests="${testcaseCount}" failures="${failureCount}" errors="0" skipped="${skippedCount}">`,
		`<testsuite name="${escapeXml(taskId)}" tests="${testcaseCount}" failures="${failureCount}" errors="0" skipped="${skippedCount}">`,
	]

	if (violations.length === 0 && gateFailures.length === 0 && suppressed.length === 0) {
		lines.push(`<testcase classname="audit" name="hardening_gate" time="0"/>`)
	} else {
		for (const violation of violations) {
			const label = formatViolationLabel(violation)
			lines.push(
				`<testcase classname="audit.violation" name="${escapeXml(violation)}" time="0">`,
				`<failure message="${escapeXml(label)}" type="${escapeXml(violation)}">${escapeXml(label)}</failure>`,
				"</testcase>",
			)
		}
		for (const failure of gateFailures) {
			lines.push(
				`<testcase classname="audit.gate" name="${escapeXml(failure.name)}" time="0">`,
				`<failure message="${escapeXml(failure.message)}" type="gate">${escapeXml(failure.message)}</failure>`,
				"</testcase>",
			)
		}
		for (const violation of suppressed) {
			const label = formatViolationLabel(violation)
			lines.push(
				`<testcase classname="audit.suppressed" name="${escapeXml(violation)}" time="0">`,
				`<skipped message="${escapeXml(label)} (waived via .audit/suppressions.json)"/>`,
				"</testcase>",
			)
		}
	}

	lines.push("</testsuite>", "</testsuites>")
	return lines.join("\n")
}
