import { beforeEach, describe, it } from "mocha"
import "should"
import * as auditGateReport from "@shared/audit/auditGateReport"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import { isWikiWriteAuthorized } from "@shared/completion/wikiWritePolicy"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	buildRetryLockedDecision,
	canRunFinalization,
	evaluateGateLifecycle,
	isTaskHarnessTerminal,
	latchEngineeringVerified,
} from "../GateLifecycleEvaluator"

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

describe("GateLifecycleEvaluator", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	it("retry-lock routes to same-session finalization when engineering verified", () => {
		taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
		taskState.engineeringVerifiedAt = Date.now()
		const decision = buildRetryLockedDecision(configWithState(taskState))
		decision.lifecycleState.should.equal("finalization_ready")
		decision.allowedActions.should.containEql("run_finalization")
		decision.forbiddenActions.should.containEql("attempt_completion")
		decision.operatorMessage.should.not.match(/new task/i)
	})

	it("engineering verified enables finalization lane", () => {
		latchEngineeringVerified(configWithState(taskState), "checkpoint-1")
		const decision = evaluateGateLifecycle(configWithState(taskState))
		decision.lifecycleState.should.equal("engineering_verified")
		decision.activeLane.should.equal("finalization")
		canRunFinalization(configWithState(taskState)).should.be.true()
	})

	it("terminal sealed session suppresses harness tool nudges", () => {
		taskState.completionLifecycleState = "completed_without_retry_completion"
		isTaskHarnessTerminal(taskState).should.be.true()
	})
})

describe("modern-only audit gate exports", () => {
	it("does not export deprecated CompletionGateDecision alias", () => {
		should(auditGateReport).not.have.property("CompletionGateDecision")
	})

	it("does not export evaluateCompletionGate alias", () => {
		should(auditGateReport).not.have.property("evaluateCompletionGate")
	})
})

describe("wikiWritePolicy", () => {
	it("allows wiki writes during finalizationMode", () => {
		isWikiWriteAuthorized({ isSubagentExecution: false, finalizationMode: true }).should.be.true()
	})

	it("blocks main agent wiki writes outside finalization", () => {
		isWikiWriteAuthorized({ isSubagentExecution: false, finalizationMode: false }).should.be.false()
	})
})
