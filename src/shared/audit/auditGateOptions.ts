import type { CompletionGateOptions } from "./auditGateReport"
import { parseIntentThresholdOverrides } from "./gatePolicy"
import type { TaskAuditMetadata } from "./types"

/** Settings slice required to build completion gate options — decoupled from TaskConfig. */
export interface AuditGateSettingsSource {
	auditCompletionGateEnabled: boolean
	auditCompletionGateThreshold: number
	auditCompletionGateCriticalOnly: boolean
	auditAdvisoryEscalationEnabled: boolean
	auditPlanRegressionGateEnabled: boolean
	auditIntentThresholdAdjustmentsEnabled: boolean
	auditIntentThresholdOverrides: string
}

export interface AuditGateOptionsExtras {
	advisoryMetadata?: TaskAuditMetadata
	planBaselineMetadata?: TaskAuditMetadata
}

export function buildCompletionGateOptionsFromSettings(
	settings: AuditGateSettingsSource,
	extras?: AuditGateOptionsExtras & { lastAdvisoryAudit?: TaskAuditMetadata },
): CompletionGateOptions {
	return {
		gateEnabled: settings.auditCompletionGateEnabled,
		scoreThreshold: settings.auditCompletionGateThreshold,
		criticalOnly: settings.auditCompletionGateCriticalOnly,
		intentAdjustedThreshold: settings.auditIntentThresholdAdjustmentsEnabled,
		intentThresholdOverrides: parseIntentThresholdOverrides(settings.auditIntentThresholdOverrides),
		advisoryMetadata: extras?.advisoryMetadata ?? extras?.lastAdvisoryAudit,
		advisoryEscalationEnabled: settings.auditAdvisoryEscalationEnabled,
		planBaselineMetadata: extras?.planBaselineMetadata,
		planRegressionGateEnabled: settings.auditPlanRegressionGateEnabled,
	}
}
