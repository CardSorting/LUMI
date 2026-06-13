import type { CompletionGateOptions } from "./auditGateReport"
import { buildQualityGateStatus } from "./auditGateStatus"
import { buildOrchestratorGateStatus } from "./auditOrchestratorDigest"
import { buildAuditSarifJson, buildAuditSarifReport } from "./auditSarifExport"
import type { TaskAuditMetadata } from "./types"

export const SARIF_HOOK_EXPORT_MAX_CHARS = 16_384

export interface AuditHookMetadataOptions {
	includeSarif?: boolean
	gateOptions?: CompletionGateOptions
	taskUri?: string
}

/** TaskComplete / CI hook metadata — mirrors GitHub check run output fields. */
export function buildAuditHookMetadata(metadata: TaskAuditMetadata, options?: AuditHookMetadataOptions): Record<string, string> {
	const gateStatus = buildOrchestratorGateStatus(metadata, options?.gateOptions)
	const qualityGate = buildQualityGateStatus(metadata, options?.gateOptions)
	const hookMeta: Record<string, string> = {
		hardeningGrade: metadata.hardening_grade ?? "",
		hardeningScore: String(metadata.hardening_score ?? ""),
		intentClassification: metadata.intent_classification ?? "",
		intentCoverage: String(metadata.intent_coverage ?? ""),
		divergenceDetected: String(metadata.divergence_detected ?? false),
		violationCount: String(metadata.violations?.length ?? 0),
		resultChecksum: metadata.result_checksum ?? "",
		gateReady: String(gateStatus?.ready ?? !metadata.gate_blocked),
		gateBlockCount: String(metadata.gate_block_count ?? 0),
		gateReasonCodes: (metadata.gate_reason_codes ?? gateStatus?.reasonCodes ?? []).join(","),
		gateEffectiveThreshold: String(metadata.gate_effective_threshold ?? gateStatus?.effectiveThreshold ?? ""),
		qualityGatePassed: String(qualityGate?.passed ?? !metadata.gate_blocked),
		qualityGateStatus: qualityGate?.status ?? "",
		suppressedViolationCount: String(metadata.suppressed_violations?.length ?? 0),
		workspacePolicyApplied: String(metadata.workspace_gate_policy_applied ?? false),
	}

	if (metadata.workspace_gate_policy_applied) {
		hookMeta.policySource = "workspace"
	}

	if (metadata.artifact_sarif_path) {
		hookMeta.artifactSarifPath = metadata.artifact_sarif_path
	}
	if (metadata.artifact_report_path) {
		hookMeta.artifactReportPath = metadata.artifact_report_path
	}
	if (metadata.artifact_manifest_path) {
		hookMeta.artifactManifestPath = metadata.artifact_manifest_path
	}

	if (options?.includeSarif) {
		const sarifReport = buildAuditSarifJson(metadata, { taskUri: options.taskUri })
		const sarif = buildAuditSarifReport(metadata, { taskUri: options.taskUri })
		const resultCount = sarif.runs[0]?.results.length ?? 0
		hookMeta.sarifVersion = "2.1.0"
		hookMeta.sarifResultCount = String(resultCount)
		if (sarifReport.length > SARIF_HOOK_EXPORT_MAX_CHARS) {
			hookMeta.sarifReport = sarifReport.slice(0, SARIF_HOOK_EXPORT_MAX_CHARS)
			hookMeta.sarifTruncated = "true"
		} else {
			hookMeta.sarifReport = sarifReport
		}
	}

	return hookMeta
}
