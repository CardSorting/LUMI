import type { AuditMessageSnapshot } from "./auditMessages"

export const AUDIT_SNAPSHOT_SOURCE_LABELS: Record<AuditMessageSnapshot["source"], string> = {
	completion: "Completion",
	plan: "Plan",
	gate_block: "Gate Block",
}

export const AUDIT_HEALTH_TREND_LABELS = {
	improving: "Improving",
	degrading: "Degrading",
	stable: "Stable",
	unknown: "",
} as const
