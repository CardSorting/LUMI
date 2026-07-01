import { formatGateReasonLabel } from "./auditGateCatalog"
import type { QualityGateStatus } from "./auditGateStatus"
import { formatViolationLabel } from "./taskAuditUtils"
import type { TaskAuditMetadata } from "./types"

/** GitHub Checks API annotation — mirrors check run `output.annotations`. */
export interface GitHubCheckAnnotation {
	path: string
	start_line: number
	end_line: number
	annotation_level: "notice" | "warning" | "failure"
	message: string
	title?: string
	raw_details?: string
}

/** GitHub Checks API output payload — compatible with `actions/create-check-run`. */
export interface GitHubCheckRunOutput {
	name: string
	head_sha?: string
	status: "completed"
	conclusion: "success" | "failure" | "neutral"
	output: {
		title: string
		summary: string
		text?: string
		annotations?: GitHubCheckAnnotation[]
	}
}

export function buildGitHubCheckRunOutput(
	metadata: TaskAuditMetadata,
	status: QualityGateStatus,
	options?: { taskId?: string; headSha?: string },
): GitHubCheckRunOutput {
	const grade = metadata.hardening_grade ?? "?"
	const conclusion: GitHubCheckRunOutput["conclusion"] = status.passed ? "success" : "neutral"

	const summaryLines = [
		`| Metric | Value |`,
		`| --- | --- |`,
		`| Grade | **${grade}** |`,
		`| Score | **${status.score}/100** (threshold ${status.effectiveThreshold}) |`,
		`| Violations | ${status.violationCount} (${status.criticalViolationCount} critical) |`,
	]

	if ((metadata.suppressed_violations?.length ?? 0) > 0) {
		summaryLines.push(`| Suppressed | ${metadata.suppressed_violations?.length ?? 0} waived |`)
	}
	if (metadata.workspace_gate_policy_applied) {
		summaryLines.push(`| Policy | Workspace gate policy applied |`)
	}
	if (status.reasonCodes.length > 0) {
		summaryLines.push("", "**Gate reasons:**", ...status.reasonCodes.map((c) => `- ${formatGateReasonLabel(c)}`))
	}

	const annotations: GitHubCheckAnnotation[] = (metadata.violations ?? []).slice(0, 50).map((violation) => ({
		path: metadata.artifact_report_path ?? ".audit/latest/summary.md",
		start_line: 1,
		end_line: 1,
		annotation_level: "warning",
		title: formatViolationLabel(violation),
		message: formatViolationLabel(violation),
		raw_details: violation,
	}))

	return {
		name: "DietCode Task Audit",
		head_sha: options?.headSha,
		status: "completed",
		conclusion,
		output: {
			title: status.advisoryFailed ? "Advisory quality findings" : "Advisory quality passed",
			summary: summaryLines.join("\n"),
			text: metadata.artifact_manifest_path ? `Manifest: \`${metadata.artifact_manifest_path}\`` : undefined,
			annotations: annotations.length > 0 ? annotations : undefined,
		},
	}
}

export function buildGitHubCheckRunJson(
	metadata: TaskAuditMetadata,
	status: QualityGateStatus,
	options?: { taskId?: string; headSha?: string },
): string {
	return JSON.stringify(buildGitHubCheckRunOutput(metadata, status, options), null, 2)
}
