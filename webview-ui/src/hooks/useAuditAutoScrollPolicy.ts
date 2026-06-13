import { buildAutoScrollPolicyFromSettings } from "@shared/audit/auditAutoScrollPolicy"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

/** Extension-settings-driven auto-scroll policy for audit chat navigation. */
export function useAuditAutoScrollPolicy() {
	const { auditActModeAdvisoryEnabled, auditAdvisoryEscalationEnabled, auditAdvisoryAutoScrollMode } = useExtensionState()

	return useMemo(
		() =>
			buildAutoScrollPolicyFromSettings({
				auditActModeAdvisoryEnabled,
				auditAdvisoryEscalationEnabled,
				auditAdvisoryAutoScrollMode,
			}),
		[auditActModeAdvisoryEnabled, auditAdvisoryEscalationEnabled, auditAdvisoryAutoScrollMode],
	)
}
