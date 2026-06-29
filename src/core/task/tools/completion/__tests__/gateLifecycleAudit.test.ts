import { beforeEach, describe, it } from "mocha"
import "should"
import * as auditGateReport from "@shared/audit/auditGateReport"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import type { FinalizationEvidence } from "@shared/completion/finalizationEvidence"
import { buildGateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import { ALL_GATE_LIFECYCLE_STATES, getGateLifecycleHeadline } from "@shared/completion/gateLifecycleLabels"
import {
	buildContinuityMarker,
	validateCompletionReceipt,
	validateFinalizationEvidenceForReceipt,
	validateLifecycleHistoryForReceipt,
} from "@shared/completion/receiptValidation"
import { isWikiWriteAuthorized } from "@shared/completion/wikiWritePolicy"
import { TaskState } from "../../../TaskState"
import { buildCompletionPreflightRecoveryHint } from "../../attemptCompletionUtils"
import type { TaskConfig } from "../../types/TaskConfig"
import { shouldRejectFakeFollowupQuestion } from "../fakeFollowupGuard"
import {
	buildRetryLockedDecision,
	cacheGateLifecycleDecision,
	canRunFinalization,
	evaluateGateLifecycle,
	isTaskHarnessTerminal,
	latchEngineeringVerified,
} from "../GateLifecycleEvaluator"
import { validateGateLifecycleDecision } from "../gateLifecycleInvariants"

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		taskState,
		finalizationMode: false,
		isSubagentExecution: false,
	} as TaskConfig
}

function passedEvidence(): FinalizationEvidence {
	return {
		finalizationRunId: "run-1",
		status: "passed",
		docsUpdated: [".wiki/changelog.md"],
		ledgerStamped: true,
		roadmapValidated: true,
		schemaValidationPassed: true,
		artifactPaths: ["/tmp/.wiki/changelog.md"],
		completedAt: Date.now(),
	}
}

describe("gate lifecycle audit guardrails", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("modern-only exports", () => {
		it("does not export deprecated CompletionGateDecision alias", () => {
			should(auditGateReport).not.have.property("CompletionGateDecision")
		})

		it("does not export evaluateCompletionGate alias", () => {
			should(auditGateReport).not.have.property("evaluateCompletionGate")
		})
	})

	describe("lifecycle exhaustiveness", () => {
		it("defines headlines for every canonical lifecycle state", () => {
			for (const state of ALL_GATE_LIFECYCLE_STATES) {
				getGateLifecycleHeadline(state).length.should.be.greaterThan(0)
			}
		})

		it("evaluator returns valid decisions for each pre-seeded terminal state", () => {
			for (const state of ["completed_without_retry_completion", "audit_gate_corrupt"] as const) {
				taskState.completionLifecycleState = state
				taskState.lastGateLifecycleDecision = JSON.stringify(
					buildGateLifecycleDecision({
						lifecycleState: state,
						activeLane: "none",
						reasonCode: state === "audit_gate_corrupt" ? "invariant.corrupt" : "receipt.sealed",
						operatorMessage: "terminal",
						engineering: state === "audit_gate_corrupt" ? "failed" : "passed",
						verification: "passed",
						documentation: state === "audit_gate_corrupt" ? "failed" : "passed",
						ledger: state === "audit_gate_corrupt" ? "failed" : "passed",
						finalization: state === "audit_gate_corrupt" ? "failed" : "passed",
						allowedActions: [],
						forbiddenActions: ["attempt_completion", "run_finalization"],
						recoveryPath: [],
						receiptEligible: state !== "audit_gate_corrupt",
						moreToolCallsUseful: false,
						userInputRequired: false,
						...(state === "completed_without_retry_completion"
							? {
									finalizationEvidence: passedEvidence(),
									completionReceipt: {
										receiptId: "r1",
										taskId: "task-1",
										outcome: "completed_without_retry_completion" as const,
										engineeringVerifiedAt: Date.now(),
										finalizationEvidence: passedEvidence(),
										gateReasonCode: "receipt.sealed" as const,
										lifecycleTransitionHistory: [
											{
												state: "engineering_verified" as const,
												reasonCode: "engineering.verified" as const,
												at: 1,
											},
											{
												state: "receipt_sealed" as const,
												reasonCode: "receipt.sealed" as const,
												at: 2,
											},
										],
										continuityMarker: "task-1:r1:1",
										sealedAt: Date.now(),
										operatorVisible: true as const,
									},
								}
							: {}),
					}),
				)
				const decision = evaluateGateLifecycle(configWithState(taskState))
				decision.lifecycleState.should.equal(state)
				should(() => validateGateLifecycleDecision(decision)).not.throw()
			}
		})
	})

	describe("retry-lock trap hardening", () => {
		it("retry-locked + verified exposes run_finalization", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			taskState.engineeringVerifiedAt = Date.now()
			const decision = buildRetryLockedDecision(configWithState(taskState))
			decision.lifecycleState.should.equal("finalization_ready")
			decision.allowedActions.should.containEql("run_finalization")
			decision.operatorMessage.should.not.match(/new task/i)
		})

		it("retry-locked + unverified does not allow run_finalization or fake success", () => {
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			const decision = buildRetryLockedDecision(configWithState(taskState))
			decision.engineering.should.equal("failed")
			decision.allowedActions.should.not.containEql("run_finalization")
			decision.finalization.should.equal("not_applicable")
		})

		it("terminal sealed session suppresses harness tool nudges", () => {
			taskState.completionLifecycleState = "completed_without_retry_completion"
			isTaskHarnessTerminal(taskState).should.be.true()
		})

		it("engineering latch is not cleared by re-evaluation", () => {
			latchEngineeringVerified(configWithState(taskState), "chk-1")
			const before = taskState.engineeringVerifiedAt
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			evaluateGateLifecycle(configWithState(taskState))
			taskState.engineeringVerifiedAt?.should.equal(before)
		})

		it("verified engineering enables finalization until sealed", () => {
			latchEngineeringVerified(configWithState(taskState), "checkpoint-1")
			canRunFinalization(configWithState(taskState)).should.be.true()
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
			canRunFinalization(configWithState(taskState)).should.be.true()
		})
	})

	describe("recovery copy hygiene", () => {
		it("circuit breaker recovery never suggests new task or session", () => {
			const hint = buildCompletionPreflightRecoveryHint("circuit_breaker")
			hint.should.containEql("run_finalization")
			hint.should.not.match(/new task/i)
			hint.should.not.match(/new session/i)
		})
	})

	describe("wiki authorization", () => {
		it("blocks main agent wiki writes outside finalization", () => {
			isWikiWriteAuthorized({ isSubagentExecution: false, finalizationMode: false }).should.be.false()
		})

		it("allows wiki writes during finalizationMode", () => {
			isWikiWriteAuthorized({ isSubagentExecution: false, finalizationMode: true }).should.be.true()
		})
	})

	describe("receipt evidence integrity", () => {
		it("rejects sealed receipt without artifact evidence", () => {
			const check = validateFinalizationEvidenceForReceipt({
				finalizationRunId: "x",
				status: "passed",
				docsUpdated: [],
				ledgerStamped: false,
				roadmapValidated: false,
				schemaValidationPassed: false,
				artifactPaths: [],
			})
			check.valid.should.be.false()
		})

		it("rejects receipt without lifecycle history", () => {
			const check = validateLifecycleHistoryForReceipt([])
			check.valid.should.be.false()
		})

		it("accepts receipt with engineering and finalization transitions", () => {
			const check = validateLifecycleHistoryForReceipt([
				{ state: "engineering_verified", reasonCode: "engineering.verified", at: 1 },
				{ state: "finalization_running", reasonCode: "finalization.running", at: 2 },
				{ state: "receipt_sealed", reasonCode: "receipt.sealed", at: 3 },
			])
			check.valid.should.be.true()
		})

		it("rejects summary-only receipt shape", () => {
			const receipt = {
				receiptId: "r1",
				taskId: "t1",
				outcome: "completed_without_retry_completion" as const,
				engineeringVerifiedAt: Date.now(),
				finalizationEvidence: passedEvidence(),
				gateReasonCode: "receipt.sealed" as const,
				lifecycleTransitionHistory: [
					{ state: "engineering_verified" as const, reasonCode: "engineering.verified" as const, at: 1 },
					{ state: "finalization_running" as const, reasonCode: "finalization.running" as const, at: 2 },
				],
				continuityMarker: buildContinuityMarker("t1", "r1", Date.now()),
				sealedAt: Date.now(),
				operatorVisible: true as const,
			}
			validateCompletionReceipt(receipt).valid.should.be.true()
			validateCompletionReceipt({
				...receipt,
				finalizationEvidence: { ...passedEvidence(), artifactPaths: [], docsUpdated: [], ledgerStamped: false },
			}).valid.should.be.false()
		})
	})

	describe("fake follow-up prevention", () => {
		it("rejects when finalization lane is available", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "finalization_ready",
				activeLane: "finalization",
				reasonCode: "finalization.ready",
				operatorMessage: "Run finalization",
				engineering: "passed",
				verification: "passed",
				documentation: "pending",
				ledger: "pending",
				finalization: "pending",
				allowedActions: ["run_finalization"],
				forbiddenActions: ["ask_followup_question"],
				recoveryPath: [{ order: 1, action: "run_finalization", description: "Finish docs." }],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			cacheGateLifecycleDecision(configWithState(taskState), decision)
			shouldRejectFakeFollowupQuestion(configWithState(taskState))?.should.match(/run_finalization/i)
		})

		it("rejects when only seal remains", () => {
			const evidence = passedEvidence()
			const decision = buildGateLifecycleDecision({
				lifecycleState: "receipt_sealed",
				activeLane: "finalization",
				reasonCode: "receipt.sealed",
				operatorMessage: "Seal receipt",
				engineering: "passed",
				verification: "passed",
				documentation: "passed",
				ledger: "passed",
				finalization: "passed",
				allowedActions: ["seal_session"],
				forbiddenActions: [],
				recoveryPath: [{ order: 1, action: "seal_session", description: "Seal session." }],
				receiptEligible: true,
				moreToolCallsUseful: true,
				userInputRequired: false,
				finalizationEvidence: evidence,
			})
			cacheGateLifecycleDecision(configWithState(taskState), decision)
			shouldRejectFakeFollowupQuestion(configWithState(taskState))?.should.match(/seal/i)
		})

		it("allows follow-up when user input is required", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "engineering_in_progress",
				activeLane: "completion",
				reasonCode: "preflight.unknown",
				operatorMessage: "Need clarification",
				engineering: "pending",
				verification: "pending",
				documentation: "not_applicable",
				ledger: "not_applicable",
				finalization: "not_applicable",
				allowedActions: ["ask_followup_question"],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: true,
			})
			cacheGateLifecycleDecision(configWithState(taskState), decision)
			should(shouldRejectFakeFollowupQuestion(configWithState(taskState))).be.null()
		})
	})
})
