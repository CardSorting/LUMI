import { formatGateReasonLabel, GATE_REASON_REMEDIATION } from "./auditGateCatalog"
import { getViolationSeverity } from "./auditSeverity"
import { getViolationRemediation } from "./completionAudit"
import { formatViolationLabel } from "./taskAuditUtils"
import type { CompletionGateReasonCode, TaskAuditMetadata } from "./types"

/** Minimal SARIF 2.1.0 log — compatible with GitHub Code Scanning / Azure DevOps. */
export interface SarifLog {
	$schema: string
	version: "2.1.0"
	runs: SarifRun[]
}

export interface SarifRun {
	tool: { driver: SarifDriver }
	results: SarifResult[]
}

export interface SarifDriver {
	name: string
	version: string
	informationUri?: string
	rules: SarifRule[]
}

export interface SarifRule {
	id: string
	name: string
	shortDescription: { text: string }
	fullDescription?: { text: string }
	defaultConfiguration: { level: SarifLevel }
}

export type SarifLevel = "error" | "warning" | "note"

export interface SarifResult {
	ruleId: string
	level: SarifLevel
	message: { text: string }
	locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>
}

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"
const TOOL_NAME = "DietCode Task Audit"
const TOOL_VERSION = "1.0.0"

function severityToSarifLevel(severity: ReturnType<typeof getViolationSeverity>): SarifLevel {
	if (severity === "critical") return "error"
	if (severity === "warning") return "warning"
	return "note"
}

function gateReasonToLevel(code: CompletionGateReasonCode): SarifLevel {
	if (code === "gate_disabled") return "note"
	if (code === "score_below_threshold" || code === "critical_violations" || code === "advisory_escalation") {
		return "error"
	}
	return "warning"
}

function buildViolationRules(violations: string[]): SarifRule[] {
	const seen = new Set<string>()
	const rules: SarifRule[] = []
	for (const violation of violations) {
		if (seen.has(violation)) continue
		seen.add(violation)
		const severity = getViolationSeverity(violation)
		rules.push({
			id: violation,
			name: formatViolationLabel(violation),
			shortDescription: { text: formatViolationLabel(violation) },
			fullDescription: { text: getViolationRemediation(violation) ?? formatViolationLabel(violation) },
			defaultConfiguration: { level: severityToSarifLevel(severity) },
		})
	}
	return rules
}

function buildGateRules(codes: CompletionGateReasonCode[]): SarifRule[] {
	return codes
		.filter((code) => code !== "gate_disabled")
		.map((code) => ({
			id: `gate:${code}`,
			name: formatGateReasonLabel(code),
			shortDescription: { text: formatGateReasonLabel(code) },
			fullDescription: { text: GATE_REASON_REMEDIATION[code] ?? formatGateReasonLabel(code) },
			defaultConfiguration: { level: gateReasonToLevel(code) },
		}))
}

export function buildAuditSarifReport(metadata: TaskAuditMetadata, options?: { taskUri?: string; runLabel?: string }): SarifLog {
	const violations = metadata.violations ?? []
	const gateCodes = metadata.gate_reason_codes ?? []
	const artifactUri = options?.taskUri ?? "task://completion-audit"
	const rules = [...buildViolationRules(violations), ...buildGateRules(gateCodes)]

	const results: SarifResult[] = violations.map((violation) => ({
		ruleId: violation,
		level: severityToSarifLevel(getViolationSeverity(violation)),
		message: {
			text: getViolationRemediation(violation) ?? formatViolationLabel(violation),
		},
		locations: [{ physicalLocation: { artifactLocation: { uri: artifactUri } } }],
	}))

	for (const code of gateCodes) {
		if (code === "gate_disabled") continue
		results.push({
			ruleId: `gate:${code}`,
			level: gateReasonToLevel(code),
			message: { text: GATE_REASON_REMEDIATION[code] ?? formatGateReasonLabel(code) },
			locations: [{ physicalLocation: { artifactLocation: { uri: artifactUri } } }],
		})
	}

	return {
		$schema: SARIF_SCHEMA,
		version: "2.1.0",
		runs: [
			{
				tool: {
					driver: {
						name: options?.runLabel ? `${TOOL_NAME} (${options.runLabel})` : TOOL_NAME,
						version: TOOL_VERSION,
						informationUri: "https://github.com/cline/cline",
						rules,
					},
				},
				results,
			},
		],
	}
}

export function buildAuditSarifJson(metadata: TaskAuditMetadata, options?: { taskUri?: string }): string {
	return JSON.stringify(buildAuditSarifReport(metadata, options), null, 2)
}
