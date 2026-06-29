import { beforeEach, describe, it } from "mocha"
import "should"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { buildGateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { evaluateGateLifecycle, latchEngineeringVerified } from "../GateLifecycleEvaluator"
import {
	assertNoContradictoryCompletionState,
	GateLifecycleInvariantError,
	validateGateLifecycleDecision,
} from "../gateLifecycleInvariants"

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

describe("gate lifecycle contradictory-state prevention", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	describe("validateGateLifecycleDecision contradictory-state rules", () => {
		it("rejects terminal state with passed engineering but failed finalization", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "audit_gate_corrupt",
				activeLane: "none",
				reasonCode: "invariant.corrupt",
				operatorMessage: "corrupt",
				engineering: "passed",
				verification: "passed",
				documentation: "failed",
				ledger: "failed",
				finalization: "failed",
				allowedActions: [],
				forbiddenActions: ["attempt_completion"],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: false,
				userInputRequired: false,
			})
			should(() => validateGateLifecycleDecision(decision)).throw(GateLifecycleInvariantError)
		})

		it("rejects receipt_sealed with pending documentation", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "receipt_sealed",
				activeLane: "finalization",
				reasonCode: "receipt.sealed",
				operatorMessage: "sealed",
				engineering: "passed",
				verification: "passed",
				documentation: "pending",
				ledger: "passed",
				finalization: "passed",
				allowedActions: ["seal_session"],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: true,
				moreToolCallsUseful: true,
				userInputRequired: false,
				finalizationEvidence: {
					finalizationRunId: "r1",
					status: "passed",
					docsUpdated: [".wiki/changelog.md"],
					ledgerStamped: true,
					roadmapValidated: true,
					schemaValidationPassed: true,
					artifactPaths: ["/tmp/.wiki/changelog.md"],
					completedAt: Date.now(),
				},
			})
			should(() => validateGateLifecycleDecision(decision)).throw(/Receipt sealed with pending/)
		})

		it("rejects finalization_running outside finalization lane", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "finalization_running",
				activeLane: "completion",
				reasonCode: "finalization.running",
				operatorMessage: "running",
				engineering: "passed",
				verification: "passed",
				documentation: "pending",
				ledger: "pending",
				finalization: "pending",
				allowedActions: [],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			should(() => validateGateLifecycleDecision(decision)).throw(/Finalization running outside finalization lane/)
		})

		it("rejects engineering_in_progress with passed finalization", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "engineering_in_progress",
				activeLane: "completion",
				reasonCode: "preflight.unknown",
				operatorMessage: "in progress",
				engineering: "pending",
				verification: "pending",
				documentation: "passed",
				ledger: "passed",
				finalization: "passed",
				allowedActions: [],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
				finalizationEvidence: {
					finalizationRunId: "r1",
					status: "passed",
					docsUpdated: [".wiki/changelog.md"],
					ledgerStamped: true,
					roadmapValidated: true,
					schemaValidationPassed: true,
					artifactPaths: ["/tmp/.wiki/changelog.md"],
					completedAt: Date.now(),
				},
			})
			should(() => validateGateLifecycleDecision(decision)).throw(/Engineering in progress with passed finalization/)
		})

		it("accepts a valid non-contradictory decision", () => {
			const decision = buildGateLifecycleDecision({
				lifecycleState: "engineering_in_progress",
				activeLane: "completion",
				reasonCode: "preflight.unknown",
				operatorMessage: "working",
				engineering: "pending",
				verification: "pending",
				documentation: "pending",
				ledger: "pending",
				finalization: "not_applicable",
				allowedActions: ["attempt_completion"],
				forbiddenActions: [],
				recoveryPath: [],
				receiptEligible: false,
				moreToolCallsUseful: true,
				userInputRequired: false,
			})
			should(() => validateGateLifecycleDecision(decision)).not.throw()
		})
	})

	describe("assertNoContradictoryCompletionState", () => {
		it("rejects engineering verified with engineering_in_progress lifecycle", () => {
			const config = configWithState(taskState)
			latchEngineeringVerified(config, "chk-1")
			taskState.completionLifecycleState = "engineering_in_progress"
			should(() => assertNoContradictoryCompletionState(config)).throw(/engineering verified but lifecycle/)
		})

		it("rejects receipt_sealed with non-zero block count", () => {
			const config = configWithState(taskState)
			taskState.completionLifecycleState = "receipt_sealed"
			taskState.completionGateBlockCount = 2
			should(() => assertNoContradictoryCompletionState(config)).throw(/receipt sealed with non-zero block count/)
		})

		it("accepts consistent state", () => {
			const config = configWithState(taskState)
			latchEngineeringVerified(config, "chk-1")
			// evaluateGateLifecycle will set a consistent lifecycleState
			evaluateGateLifecycle(config)
			should(() => assertNoContradictoryCompletionState(config)).not.throw()
		})
	})

	describe("retry-locked verified engineering consistency", () => {
		it("engineering latch survives repeated evaluation without contradiction", () => {
			const config = configWithState(taskState)
			latchEngineeringVerified(config, "chk-persist")
			taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT

			// Multiple evaluations should not trigger contradiction
			for (let i = 0; i < 5; i++) {
				evaluateGateLifecycle(config)
				should(() => assertNoContradictoryCompletionState(config)).not.throw()
			}
		})
	})
})
