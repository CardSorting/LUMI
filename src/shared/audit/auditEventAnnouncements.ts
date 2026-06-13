import { formatGateReasonLabel } from "./auditGateCatalog"
import type { AuditMessageSnapshot } from "./auditMessages"
import { formatViolationLabel } from "./taskAuditUtils"

/** Screen-reader announcement when a new gate block or advisory arrives in chat. */
export function buildAuditEventLiveAnnouncement(snapshot: AuditMessageSnapshot): string {
	const grade = snapshot.auditMetadata.hardening_grade ?? "unknown"
	const score = Number.isFinite(snapshot.auditMetadata.hardening_score)
		? ` score ${snapshot.auditMetadata.hardening_score}`
		: ""

	if (snapshot.auditMetadata.gate_blocked) {
		const attempt =
			snapshot.auditMetadata.gate_block_count && snapshot.auditMetadata.gate_block_count > 0
				? ` attempt ${snapshot.auditMetadata.gate_block_count}`
				: ""
		const reasons =
			snapshot.auditMetadata.gate_reason_codes
				?.filter((code) => code !== "gate_disabled")
				.map(formatGateReasonLabel)
				.join(", ") ?? ""
		return `Completion gate blocked${attempt}. Grade ${grade}${score}.${reasons ? ` ${reasons}.` : ""}`
	}

	if (snapshot.source === "advisory") {
		const violations = snapshot.auditMetadata.violations ?? []
		const labels = violations.slice(0, 3).map(formatViolationLabel).join(", ")
		const divergent = snapshot.auditMetadata.divergence_detected ? " Divergent progress." : ""
		return `Act-mode audit advisory. Grade ${grade}${score}.${labels ? ` Flagged: ${labels}.` : ""}${divergent}`
	}

	return ""
}
