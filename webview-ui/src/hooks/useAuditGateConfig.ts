import { buildAuditGateConfig } from "@shared/audit/auditGateConfig"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

/** Shared gate config from extension settings — DRY for task header, badges, and panels. */
export function useAuditGateConfig() {
	const {
		auditCompletionGateEnabled,
		auditCompletionGateThreshold,
		auditCompletionGateCriticalOnly,
		auditAdvisoryEscalationEnabled,
		auditPlanRegressionGateEnabled,
		auditIntentThresholdAdjustmentsEnabled,
		auditIntentThresholdOverrides,
	} = useExtensionState()

	return useMemo(
		() =>
			buildAuditGateConfig({
				auditCompletionGateEnabled: auditCompletionGateEnabled ?? true,
				auditCompletionGateThreshold: auditCompletionGateThreshold ?? 50,
				auditCompletionGateCriticalOnly: auditCompletionGateCriticalOnly ?? false,
				auditAdvisoryEscalationEnabled: auditAdvisoryEscalationEnabled ?? true,
				auditPlanRegressionGateEnabled: auditPlanRegressionGateEnabled ?? true,
				auditIntentThresholdAdjustmentsEnabled: auditIntentThresholdAdjustmentsEnabled ?? true,
				auditIntentThresholdOverrides: auditIntentThresholdOverrides ?? "{}",
			}),
		[
			auditCompletionGateEnabled,
			auditCompletionGateThreshold,
			auditCompletionGateCriticalOnly,
			auditAdvisoryEscalationEnabled,
			auditPlanRegressionGateEnabled,
			auditIntentThresholdAdjustmentsEnabled,
			auditIntentThresholdOverrides,
		],
	)
}
