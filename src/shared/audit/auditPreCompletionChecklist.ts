import { filterNewViolationsSinceBaseline } from "./auditBaseline"
import { formatGateReasonLabel } from "./auditGateCatalog"
import { type CompletionGateOptions, evaluateAuditGate } from "./auditGateReport"
import { partitionViolationsBySeverity } from "./auditSeverity"
import { formatViolationLabel } from "./taskAuditUtils"
import type { TaskAuditMetadata } from "./types"

export type PreCompletionChecklistStatus = "pass" | "fail" | "warn" | "info"

export interface PreCompletionChecklistItem {
	key: string
	label: string
	status: PreCompletionChecklistStatus
	detail?: string
}

export interface PreCompletionChecklistSummary {
	blocked: boolean
	score: number
	effectiveThreshold: number
	grade?: TaskAuditMetadata["hardening_grade"]
	items: PreCompletionChecklistItem[]
}

/** Structured pre-completion gate checklist — GitHub Checks / SonarQube quality gate UI. */
export function buildPreCompletionChecklistSummary(
	metadata: TaskAuditMetadata | undefined,
	options?: CompletionGateOptions,
): PreCompletionChecklistSummary | undefined {
	if (!metadata || options?.gateEnabled === false) {
		return undefined
	}

	const decision = evaluateAuditGate(metadata, options)
	const gateViolations =
		options?.newViolationsOnly && options.baselineMetadata
			? filterNewViolationsSinceBaseline(metadata.violations, options.baselineMetadata)
			: (metadata.violations ?? [])
	const { critical, warning } = partitionViolationsBySeverity(gateViolations)
	const items: PreCompletionChecklistItem[] = []

	const scorePassed = decision.score >= decision.effectiveThreshold
	items.push({
		key: "hardening_score",
		label: `Hardening score ${decision.score}/${decision.effectiveThreshold}`,
		status: scorePassed ? "pass" : decision.blocked ? "fail" : "warn",
		detail: decision.grade ? `Grade ${decision.grade}` : undefined,
	})

	if (options?.newViolationsOnly) {
		const grandfathered = Math.max(0, (metadata.violations?.length ?? 0) - gateViolations.length)
		items.push({
			key: "new_code_gate",
			label: `New-code gate (${gateViolations.length} blocking since baseline)`,
			status: gateViolations.length === 0 ? "pass" : "fail",
			detail: grandfathered > 0 ? `${grandfathered} grandfathered violation(s) excluded` : undefined,
		})
	}

	if (critical.length > 0) {
		items.push({
			key: "critical_violations",
			label: `${critical.length} critical violation(s)`,
			status: "fail",
			detail: critical.slice(0, 3).map(formatViolationLabel).join(", "),
		})
	} else if (warning.length > 0) {
		items.push({
			key: "warning_violations",
			label: `${warning.length} warning violation(s)`,
			status: decision.blocked ? "fail" : "warn",
			detail: warning.slice(0, 3).map(formatViolationLabel).join(", "),
		})
	} else if ((metadata.violations?.length ?? 0) === 0) {
		items.push({
			key: "violations",
			label: "No policy violations",
			status: "pass",
		})
	}

	for (const reason of decision.reasons) {
		if (reason.code === "gate_disabled" || reason.code === "score_below_threshold") {
			continue
		}
		items.push({
			key: reason.code,
			label: formatGateReasonLabel(reason.code),
			status: "fail",
			detail: reason.message,
		})
	}

	const suppressed = metadata.suppressed_violations ?? []
	if (suppressed.length > 0) {
		items.push({
			key: "suppressed_violations",
			label: `${suppressed.length} waived violation(s)`,
			status: "info",
			detail: suppressed.slice(0, 3).map(formatViolationLabel).join(", "),
		})
	}

	return {
		blocked: decision.blocked,
		score: decision.score,
		effectiveThreshold: decision.effectiveThreshold,
		grade: decision.grade,
		items,
	}
}

export function shouldShowPreCompletionChecklist(summary: PreCompletionChecklistSummary | undefined): boolean {
	return !!summary && summary.items.length > 0
}

/** Markdown export for pre-completion checklist — mirrors server-side agent preview block. */
export function buildPreCompletionChecklistMarkdown(summary: PreCompletionChecklistSummary): string {
	const statusIcon = (status: PreCompletionChecklistStatus): string => {
		switch (status) {
			case "pass":
				return "✓"
			case "fail":
				return "✗"
			case "warn":
				return "⚠"
			default:
				return "·"
		}
	}

	const lines = [
		"## Pre-Completion Quality Gate",
		"",
		`- Status: ${summary.blocked ? "**BLOCKED**" : "Ready"}`,
		`- Score: ${summary.score}/${summary.effectiveThreshold}${summary.grade ? ` (Grade ${summary.grade})` : ""}`,
		"",
	]

	for (const item of summary.items) {
		lines.push(`- ${statusIcon(item.status)} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`)
	}
	lines.push("")
	return lines.join("\n")
}

/** Machine-parseable pre-completion checklist — mirrors GitHub Checks annotations. */
export function buildPreCompletionChecklistBlock(summary: PreCompletionChecklistSummary): string {
	const itemElements = summary.items
		.map(
			(item) =>
				`<check key="${item.key}" status="${item.status}">${escapePreCompletionXmlText(item.label)}` +
				`${item.detail ? ` — ${escapePreCompletionXmlText(item.detail)}` : ""}</check>`,
		)
		.join("")
	return (
		`<pre_completion_checklist blocked="${summary.blocked ? "true" : "false"}" ` +
		`score="${summary.score}" threshold="${summary.effectiveThreshold}"` +
		`${summary.grade ? ` grade="${summary.grade}"` : ""}>${itemElements}</pre_completion_checklist>`
	)
}

function escapePreCompletionXmlText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
