import type { CompletionReceipt } from "@shared/completion/finalizationEvidence"
import { buildGateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import { parseLifecycleTransitionLog } from "@shared/completion/lifecycleTransitionLog"
import {
	buildContinuityMarker,
	validateCompletionReceipt,
	validateFinalizationEvidenceForReceipt,
	validateLifecycleHistoryForReceipt,
} from "@shared/completion/receiptValidation"
import { v4 as uuidv4 } from "uuid"
import { finalizeRoadmapSession } from "@/services/roadmap/RoadmapLifecycle"
import { markCompletionAttemptFinished } from "../attemptCompletionUtils"
import {
	cacheGateLifecycleDecision,
	evaluateGateLifecycle,
	latchEngineeringVerified,
	publishGateLifecycleStatus,
} from "../completion/GateLifecycleEvaluator"
import type { TaskConfig } from "../types/TaskConfig"
import { AutonomousDocumentationFinalizer } from "./AutonomousDocumentationFinalizer"

export interface FinalizationRunnerResult {
	success: boolean
	message: string
	evidenceJson?: string
	receiptJson?: string
	accessDenied?: boolean
}

export class FinalizationRunner {
	constructor(private readonly config: TaskConfig) {}

	async run(): Promise<FinalizationRunnerResult> {
		if (!this.config.taskState.engineeringVerifiedAt) {
			return {
				success: false,
				message: "Finalization requires canonical lifecycle verification from an allowed attempt_completion action.",
			}
		}

		const existing = await AutonomousDocumentationFinalizer.readExistingEvidence(this.config)
		if (existing?.status === "passed") {
			const checksum = AutonomousDocumentationFinalizer.evidenceChecksum(existing)
			if (this.config.taskState.finalizationRunId === checksum) {
				const decision = evaluateGateLifecycle(this.config)
				await publishGateLifecycleStatus(this.config, decision)
				return {
					success: true,
					message: "Finalization already completed in this session (idempotent replay).",
					evidenceJson: this.config.taskState.finalizationEvidenceJson,
				}
			}
		}

		this.config.finalizationMode = true
		this.config.taskState.finalizationPhase = "running"
		await publishGateLifecycleStatus(
			this.config,
			buildGateLifecycleDecision({
				...evaluateGateLifecycle(this.config),
				lifecycleState: "finalization_running",
				reasonCode: "finalization.running",
				finalization: "running",
				operatorMessage: "Finalization running — updating documentation and ledger in this session.",
			}),
		)

		try {
			const finalizer = new AutonomousDocumentationFinalizer(this.config)
			const result = await finalizer.run(this.config.taskState.finalizationRunId)

			if (result.accessDenied) {
				this.config.taskState.finalizationPhase = "failed"
				const decision = buildGateLifecycleDecision({
					lifecycleState: "audit_gate_corrupt",
					activeLane: "finalization",
					reasonCode: "finalization.access_denied",
					operatorMessage: `Finalization access denied: ${result.accessDeniedReason ?? "permission denied"}`,
					engineering: "passed",
					verification: "passed",
					documentation: "failed",
					ledger: "failed",
					finalization: "failed",
					allowedActions: ["act_mode_respond"],
					forbiddenActions: ["attempt_completion", "run_finalization"],
					recoveryPath: [],
					receiptEligible: false,
					moreToolCallsUseful: false,
					userInputRequired: false,
					finalizationEvidence: result.evidence,
				})
				await publishGateLifecycleStatus(this.config, decision)
				return {
					success: false,
					message: decision.operatorMessage,
					accessDenied: true,
					evidenceJson: JSON.stringify(result.evidence),
				}
			}

			const validation = await finalizer.validate(result.evidence)
			if (!validation.valid) {
				this.config.taskState.finalizationPhase = "failed"
				return {
					success: false,
					message: `Finalization validation failed: ${validation.reason}`,
					evidenceJson: JSON.stringify(result.evidence),
				}
			}

			this.config.taskState.finalizationPhase = "completed"
			this.config.taskState.finalizationRunId = AutonomousDocumentationFinalizer.evidenceChecksum(result.evidence)
			this.config.taskState.finalizationEvidenceJson = JSON.stringify(result.evidence)

			const decision = buildGateLifecycleDecision({
				lifecycleState: "receipt_sealed",
				activeLane: "finalization",
				reasonCode: "finalization.completed",
				operatorMessage: "Finalization complete. Seal the receipt to end this session.",
				engineering: "passed",
				verification: "passed",
				documentation: "passed",
				ledger: "passed",
				finalization: "passed",
				allowedActions: ["seal_session"],
				forbiddenActions: [],
				recoveryPath: [
					{ order: 1, action: "seal_session", description: "Seal the session and emit the completion receipt." },
				],
				receiptEligible: true,
				moreToolCallsUseful: true,
				userInputRequired: false,
				finalizationEvidence: result.evidence,
			})
			await publishGateLifecycleStatus(this.config, decision)

			return {
				success: true,
				message: decision.operatorMessage,
				evidenceJson: JSON.stringify(result.evidence),
			}
		} finally {
			this.config.finalizationMode = false
		}
	}

	async sealSession(summary?: string): Promise<FinalizationRunnerResult> {
		const evidence = await AutonomousDocumentationFinalizer.readExistingEvidence(this.config)
		const evidenceCheck = validateFinalizationEvidenceForReceipt(evidence)
		if (!evidenceCheck.valid) {
			return {
				success: false,
				message: evidenceCheck.reason ?? "Cannot seal session — run finalization and validate evidence first.",
			}
		}

		if (!this.config.taskState.engineeringVerifiedAt) {
			return {
				success: false,
				message: "Cannot seal session — engineering verification evidence is missing.",
			}
		}

		let lifecycleTransitionHistory = parseLifecycleTransitionLog(this.config.taskState.lifecycleTransitionLogJson)
		if (
			!lifecycleTransitionHistory.some(
				(entry) =>
					entry.state === "engineering_verified" ||
					entry.state === "finalization_ready" ||
					entry.state === "receipt_sealed",
			)
		) {
			lifecycleTransitionHistory = [
				{
					state: "engineering_verified",
					reasonCode: "engineering.verified",
					at: this.config.taskState.engineeringVerifiedAt,
				},
				...lifecycleTransitionHistory,
			]
		}
		const historyCheck = validateLifecycleHistoryForReceipt(lifecycleTransitionHistory)
		if (!historyCheck.valid) {
			return {
				success: false,
				message: historyCheck.reason ?? "Cannot seal session — lifecycle transition history is incomplete.",
			}
		}

		const receiptId = uuidv4()
		const sealedAt = Date.now()
		const receipt: CompletionReceipt = {
			receiptId,
			taskId: this.config.taskId,
			outcome: "completed_without_retry_completion",
			engineeringVerifiedAt: this.config.taskState.engineeringVerifiedAt,
			engineeringCheckpointHash: this.config.taskState.engineeringVerifiedCheckpointHash,
			auditScore: this.config.taskState.lastCompletionAudit?.hardening_score,
			finalizationEvidence: evidence!,
			changedFilesSummary: this.config.universalGuard?.getSessionImpactSummary(),
			gateReasonCode: "receipt.sealed",
			lifecycleTransitionHistory,
			continuityMarker: buildContinuityMarker(this.config.taskId, receiptId, sealedAt),
			sealedAt,
			operatorVisible: true,
		}

		const receiptCheck = validateCompletionReceipt(receipt)
		if (!receiptCheck.valid) {
			return { success: false, message: receiptCheck.reason ?? "Cannot emit invalid receipt." }
		}

		this.config.taskState.completionReceiptJson = JSON.stringify(receipt)

		try {
			await finalizeRoadmapSession(this.config.cwd, this.config.taskId)
		} catch {
			// Non-fatal
		}

		markCompletionAttemptFinished(this.config)

		const decision = buildGateLifecycleDecision({
			lifecycleState: "completed_without_retry_completion",
			activeLane: "none",
			reasonCode: "receipt.sealed",
			operatorMessage: summary ?? "Session sealed. Engineering and finalization completed in this session.",
			engineering: "passed",
			verification: "passed",
			documentation: "passed",
			ledger: "passed",
			finalization: "passed",
			allowedActions: [],
			forbiddenActions: ["attempt_completion", "run_finalization"],
			recoveryPath: [],
			receiptEligible: true,
			moreToolCallsUseful: false,
			userInputRequired: false,
			finalizationEvidence: evidence,
			completionReceipt: receipt,
		})
		await publishGateLifecycleStatus(this.config, decision)

		return {
			success: true,
			message: decision.operatorMessage,
			receiptJson: JSON.stringify(receipt),
			evidenceJson: JSON.stringify(evidence),
		}
	}
}

export function latchEngineeringFromAuditPass(config: TaskConfig, checkpointHash?: string): void {
	latchEngineeringVerified(config, checkpointHash)
	cacheGateLifecycleDecision(config, evaluateGateLifecycle(config))
}
