import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { type AuditGateConfig, auditGateConfigToOptions } from "./auditGateConfig"
import type { CompletionGateOptions } from "./auditGateReport"
import { getAuditSnapshotsFromMessages, getLatestPlanAuditFromMessages } from "./auditMessages"
import type { TaskAuditMetadata } from "./types"

/** Infers whether the server evaluated a SonarQube-style new-code gate for this metadata. */
export function metadataUsesNewViolationsGate(metadata: TaskAuditMetadata | undefined): boolean {
	if (!metadata) return false
	if (metadata.gate_reason_codes?.includes("policy_violations")) return true
	return metadata.workspace_gate_policy_applied === true && (metadata.violations?.length ?? 0) > 0
}

/**
 * Best-effort task-session baseline for UI gate preview when workspace baseline is unavailable.
 * Uses the most recent non-blocked snapshot before the latest — mirrors rolling CI baseline.
 */
export function inferTaskSessionBaselineMetadata(
	snapshots: Array<{ auditMetadata: TaskAuditMetadata }>,
): TaskAuditMetadata | undefined {
	if (snapshots.length === 0) return undefined
	for (let i = snapshots.length - 2; i >= 0; i--) {
		if (!snapshots[i].auditMetadata.gate_blocked) {
			return snapshots[i].auditMetadata
		}
	}
	return snapshots[0].auditMetadata
}

/**
 * Builds enriched gate options for webview evaluation — aligns UI readiness with server-side
 * AttemptCompletionHandler context (plan baseline, new-code gate, policy provenance).
 */
export function buildUIGateEvaluationOptions(
	config: AuditGateConfig,
	messages: DietCodeMessage[],
	targetMetadata?: TaskAuditMetadata,
): CompletionGateOptions {
	const options: CompletionGateOptions = {
		...auditGateConfigToOptions(config),
	}

	const planBaseline = getLatestPlanAuditFromMessages(messages)
	if (planBaseline) {
		options.planBaselineMetadata = planBaseline
	}

	const snapshots = getAuditSnapshotsFromMessages(messages)
	if (metadataUsesNewViolationsGate(targetMetadata ?? snapshots.at(-1)?.auditMetadata)) {
		const baseline = inferTaskSessionBaselineMetadata(snapshots)
		if (baseline) {
			options.newViolationsOnly = true
			options.baselineMetadata = baseline
		}
	}

	return options
}
