import type { TaskAuditMetadata } from "@shared/ExtensionMessage"

export const AUDIT_MEMORY_KEYS = {
	preAuditedIntent: "pre_audited_intent",
	lastCompletionAudit: "last_completion_audit",
	auditTrailPrefix: "audit_trail_",
} as const

export function serializeAuditMetadata(metadata: TaskAuditMetadata): string {
	return JSON.stringify(metadata)
}

export function deserializeAuditMetadata(raw: string | null | undefined): TaskAuditMetadata | undefined {
	if (!raw?.trim()) {
		return undefined
	}
	try {
		return JSON.parse(raw) as TaskAuditMetadata
	} catch {
		return undefined
	}
}

export function buildAuditTrailKey(timestamp = Date.now()): string {
	return `${AUDIT_MEMORY_KEYS.auditTrailPrefix}${timestamp}`
}
