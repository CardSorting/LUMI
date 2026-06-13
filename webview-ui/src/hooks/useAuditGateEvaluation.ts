import { buildUIGateEvaluationOptions } from "@shared/audit/auditGateUiOptions"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAuditGateConfig } from "@/hooks/useAuditGateConfig"

/** Enriched gate options for UI — mirrors server-side AttemptCompletionHandler evaluation context. */
export function useAuditGateEvaluation(targetMetadata?: TaskAuditMetadata) {
	const gateConfig = useAuditGateConfig()
	const { dietcodeMessages } = useExtensionState()

	return useMemo(
		() => buildUIGateEvaluationOptions(gateConfig, dietcodeMessages, targetMetadata),
		[gateConfig, dietcodeMessages, targetMetadata],
	)
}
