import { formatGateReasonLabel } from "./auditGateCatalog"
import { type CompletionGateOptions, evaluateAuditGate } from "./auditGateReport"
import { partitionViolationsBySeverity } from "./auditSeverity"
import type { TaskAuditMetadata } from "./types"

export interface OrchestratorGateStatus {
	ready: boolean
	score: number
	effectiveThreshold: number
	grade?: TaskAuditMetadata["hardening_grade"]
	reasonCodes: string[]
	reasonLabels: string[]
	criticalViolationCount: number
	warningViolationCount: number
	gateBlockCount?: number
	artifactSarifPath?: string
	artifactReportPath?: string
	artifactManifestPath?: string
}

/** Compact gate status for orchestrator/swarm coordination digests. */
export function buildOrchestratorGateStatus(
	metadata: TaskAuditMetadata | undefined,
	options?: CompletionGateOptions,
): OrchestratorGateStatus | undefined {
	if (!metadata) {
		return undefined
	}

	const decision = evaluateAuditGate(metadata, options)
	const { critical, warning } = partitionViolationsBySeverity(metadata.violations)

	return {
		ready: !decision.blocked,
		score: decision.score,
		effectiveThreshold: decision.effectiveThreshold,
		grade: decision.grade,
		reasonCodes: decision.reasons.map((r) => r.code).filter((c) => c !== "gate_disabled"),
		reasonLabels: decision.reasons.filter((r) => r.code !== "gate_disabled").map((r) => formatGateReasonLabel(r.code)),
		criticalViolationCount: critical.length,
		warningViolationCount: warning.length,
		gateBlockCount: metadata.gate_block_count,
		artifactSarifPath: metadata.artifact_sarif_path,
		artifactReportPath: metadata.artifact_report_path,
		artifactManifestPath: metadata.artifact_manifest_path,
	}
}
