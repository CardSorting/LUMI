import type { AuditMessageSnapshot } from "./auditMessages"
import { hasCriticalViolations } from "./auditSeverity"

/** Advisory auto-scroll modes — GitHub Checks vs SonarQube notification granularity. */
export type AdvisoryAutoScrollMode = "never" | "critical" | "all"

export const ADVISORY_AUTO_SCROLL_MODE_LABELS: Record<AdvisoryAutoScrollMode, string> = {
	never: "Never — gate blocks only",
	critical: "Critical advisories only",
	all: "All advisories",
}

export function normalizeAdvisoryAutoScrollMode(value: string | undefined): AdvisoryAutoScrollMode | undefined {
	if (value === "never" || value === "critical" || value === "all") {
		return value
	}
	return undefined
}

export interface AuditAutoScrollPolicy {
	/** When true, new gate-block snapshots trigger chat auto-scroll. */
	scrollGateBlocks: boolean
	/** Controls act-mode advisory auto-scroll aggressiveness. */
	advisoryMode: AdvisoryAutoScrollMode
}

export const DEFAULT_AUDIT_AUTO_SCROLL_POLICY: AuditAutoScrollPolicy = {
	scrollGateBlocks: true,
	advisoryMode: "critical",
}

/** Maps extension audit settings to auto-scroll policy — avoids chat noise when advisories disabled. */
export function buildAutoScrollPolicyFromSettings(settings: {
	auditActModeAdvisoryEnabled?: boolean
	auditAdvisoryEscalationEnabled?: boolean
	auditAdvisoryAutoScrollMode?: AdvisoryAutoScrollMode
}): AuditAutoScrollPolicy {
	if (settings.auditAdvisoryAutoScrollMode) {
		return {
			scrollGateBlocks: true,
			advisoryMode: settings.auditAdvisoryAutoScrollMode,
		}
	}
	if (settings.auditActModeAdvisoryEnabled === false || settings.auditAdvisoryEscalationEnabled === false) {
		return { scrollGateBlocks: true, advisoryMode: "never" }
	}
	return DEFAULT_AUDIT_AUTO_SCROLL_POLICY
}

export function shouldAutoScrollAuditEvent(
	snapshot: AuditMessageSnapshot,
	policy: AuditAutoScrollPolicy = DEFAULT_AUDIT_AUTO_SCROLL_POLICY,
): boolean {
	if (snapshot.auditMetadata.gate_blocked && policy.scrollGateBlocks) {
		return true
	}
	if (snapshot.source !== "advisory") {
		return false
	}
	if (policy.advisoryMode === "never") {
		return false
	}
	const hasFindings =
		(snapshot.auditMetadata.violations?.length ?? 0) > 0 || snapshot.auditMetadata.divergence_detected === true
	if (!hasFindings) {
		return false
	}
	if (policy.advisoryMode === "all") {
		return true
	}
	return hasCriticalViolations(snapshot.auditMetadata.violations) || snapshot.auditMetadata.divergence_detected === true
}
