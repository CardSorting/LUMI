import type { AuditGateDecision } from "@shared/audit/auditGateReport"
import type { GateActiveLane, GateAxisStatus, GateLifecycleState } from "./completionLifecycle"
import type { CompletionReceipt, FinalizationEvidence } from "./finalizationEvidence"
import type { GateAction, GateRecoveryStep } from "./gateActions"
import type { GateReasonCode } from "./gateReasonCodes"

export interface GateLifecycleDecision {
	lifecycleState: GateLifecycleState
	activeLane: GateActiveLane
	reasonCode: GateReasonCode
	operatorMessage: string
	engineering: GateAxisStatus
	verification: GateAxisStatus
	documentation: GateAxisStatus
	ledger: GateAxisStatus
	finalization: GateAxisStatus
	allowedActions: GateAction[]
	forbiddenActions: GateAction[]
	recoveryPath: GateRecoveryStep[]
	receiptEligible: boolean
	moreToolCallsUseful: boolean
	userInputRequired: boolean
	httpStatus?: number
	finalizationEvidence?: FinalizationEvidence
	completionReceipt?: CompletionReceipt
	auditDecision?: AuditGateDecision
	evaluatedAt: number
}

export function buildGateLifecycleDecision(partial: Omit<GateLifecycleDecision, "evaluatedAt">): GateLifecycleDecision {
	return { ...partial, evaluatedAt: Date.now() }
}
