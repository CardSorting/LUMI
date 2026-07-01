import { describeGateReadiness, type GateReadinessLevel } from "./auditGateReadiness"
import type { CompletionGateOptions } from "./auditGateReport"
import { evaluateAuditGate } from "./auditGateReport"
import { partitionViolationsBySeverity } from "./auditSeverity"
import type { CompletionGateReasonCode, TaskAuditMetadata } from "./types"

/** SonarQube-style quality gate status — single export for UI, hooks, and CI adapters. */
export interface QualityGateStatus {
	status: GateReadinessLevel
	passed: boolean
	/** Quality threshold was not met; diagnostic only. */
	advisoryFailed: boolean
	/** @deprecated Completion diagnostics never block execution. */
	blocked: boolean
	score: number
	effectiveThreshold: number
	grade?: TaskAuditMetadata["hardening_grade"]
	reasonCodes: CompletionGateReasonCode[]
	violationCount: number
	criticalViolationCount: number
	suppressedViolationCount: number
	workspacePolicyApplied: boolean
	artifactPaths?: {
		sarif?: string
		report?: string
		manifest?: string
	}
}

export function buildQualityGateStatus(
	metadata: TaskAuditMetadata | undefined,
	options?: CompletionGateOptions,
): QualityGateStatus | undefined {
	if (!metadata?.hardening_grade) {
		return undefined
	}

	const decision = evaluateAuditGate(metadata, options)
	const readiness = describeGateReadiness(metadata, options)
	const violations = metadata.violations ?? []

	return {
		status: readiness.level,
		passed: !decision.blocked,
		advisoryFailed: decision.blocked || metadata.gate_blocked === true,
		blocked: false,
		score: decision.score,
		effectiveThreshold: decision.effectiveThreshold,
		grade: metadata.hardening_grade,
		reasonCodes: decision.reasons.map((reason) => reason.code).filter((code) => code !== "gate_disabled"),
		violationCount: violations.length,
		criticalViolationCount: partitionViolationsBySeverity(violations).critical.length,
		suppressedViolationCount: metadata.suppressed_violations?.length ?? 0,
		workspacePolicyApplied: metadata.workspace_gate_policy_applied ?? false,
		artifactPaths:
			metadata.artifact_sarif_path || metadata.artifact_report_path || metadata.artifact_manifest_path
				? {
						sarif: metadata.artifact_sarif_path,
						report: metadata.artifact_report_path,
						manifest: metadata.artifact_manifest_path,
					}
				: undefined,
	}
}
