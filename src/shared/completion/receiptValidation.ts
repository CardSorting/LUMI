import type { CompletionReceipt, FinalizationEvidence } from "@shared/completion/finalizationEvidence"
import { type GateLifecycleTransitionRecord, parseLifecycleTransitionLog } from "@shared/completion/lifecycleTransitionLog"

export interface ReceiptValidationResult {
	valid: boolean
	reason?: string
}

export function validateFinalizationEvidenceForReceipt(evidence: FinalizationEvidence | undefined): ReceiptValidationResult {
	if (!evidence || evidence.status !== "passed") {
		return { valid: false, reason: "Finalization evidence must be passed before sealing." }
	}
	if (!evidence.artifactPaths.length) {
		return { valid: false, reason: "Finalization evidence must include artifact paths." }
	}
	if (!evidence.docsUpdated.length) {
		return { valid: false, reason: "Finalization evidence must include documentation updates." }
	}
	if (!evidence.ledgerStamped) {
		return { valid: false, reason: "Finalization evidence must include ledger stamp." }
	}
	return { valid: true }
}

export function validateLifecycleHistoryForReceipt(history: GateLifecycleTransitionRecord[]): ReceiptValidationResult {
	if (history.length === 0) {
		return { valid: false, reason: "Lifecycle transition history is required for sealed receipts." }
	}
	const hasEngineering = history.some(
		(entry) =>
			entry.state === "engineering_verified" || entry.state === "finalization_ready" || entry.state === "receipt_sealed",
	)
	if (!hasEngineering) {
		return { valid: false, reason: "Lifecycle history must include engineering verification." }
	}
	const hasFinalization = history.some(
		(entry) =>
			entry.state === "finalization_running" ||
			entry.state === "finalization_completed" ||
			entry.state === "receipt_sealed",
	)
	if (!hasFinalization) {
		return { valid: false, reason: "Lifecycle history must include finalization execution." }
	}
	return { valid: true }
}

export function buildContinuityMarker(taskId: string, receiptId: string, sealedAt: number): string {
	return `${taskId}:${receiptId}:${sealedAt}`
}

export function validateCompletionReceipt(receipt: CompletionReceipt): ReceiptValidationResult {
	if (!receipt.engineeringVerifiedAt) {
		return { valid: false, reason: "Receipt requires engineering verification timestamp." }
	}
	const evidenceCheck = validateFinalizationEvidenceForReceipt(receipt.finalizationEvidence)
	if (!evidenceCheck.valid) {
		return evidenceCheck
	}
	const historyCheck = validateLifecycleHistoryForReceipt(receipt.lifecycleTransitionHistory)
	if (!historyCheck.valid) {
		return historyCheck
	}
	if (!receipt.continuityMarker?.includes(receipt.taskId)) {
		return { valid: false, reason: "Receipt continuity marker must include task id." }
	}
	if (!receipt.gateReasonCode) {
		return { valid: false, reason: "Receipt requires gate reason code." }
	}
	return { valid: true }
}

export function parseReceiptLifecycleHistory(raw?: string): GateLifecycleTransitionRecord[] {
	return parseLifecycleTransitionLog(raw)
}
