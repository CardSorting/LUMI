import type { AuditGateSettingsSource } from "./auditGateOptions"
import type { CompletionGateOptions } from "./auditGateReport"
import { parseIntentThresholdOverrides } from "./gatePolicy"

/** UI-facing gate configuration — shared across task header, subagent badges, and panels. */
export interface AuditGateConfig {
	gateEnabled?: boolean
	scoreThreshold?: number
	criticalOnly?: boolean
	advisoryEscalationEnabled?: boolean
	planRegressionGateEnabled?: boolean
	intentAdjustedThreshold?: boolean
	intentThresholdOverrides?: Partial<Record<string, number>>
}

export function buildAuditGateConfig(settings: AuditGateSettingsSource): AuditGateConfig {
	return {
		gateEnabled: settings.auditCompletionGateEnabled,
		scoreThreshold: settings.auditCompletionGateThreshold,
		criticalOnly: settings.auditCompletionGateCriticalOnly,
		advisoryEscalationEnabled: settings.auditAdvisoryEscalationEnabled,
		planRegressionGateEnabled: settings.auditPlanRegressionGateEnabled,
		intentAdjustedThreshold: settings.auditIntentThresholdAdjustmentsEnabled,
		intentThresholdOverrides: parseIntentThresholdOverrides(settings.auditIntentThresholdOverrides),
	}
}

export function auditGateConfigToOptions(config: AuditGateConfig): CompletionGateOptions {
	return {
		gateEnabled: config.gateEnabled,
		scoreThreshold: config.scoreThreshold,
		criticalOnly: config.criticalOnly,
		advisoryEscalationEnabled: config.advisoryEscalationEnabled,
		planRegressionGateEnabled: config.planRegressionGateEnabled,
		intentAdjustedThreshold: config.intentAdjustedThreshold,
		intentThresholdOverrides: config.intentThresholdOverrides as CompletionGateOptions["intentThresholdOverrides"],
	}
}
