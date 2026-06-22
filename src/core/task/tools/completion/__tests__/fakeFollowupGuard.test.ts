import { beforeEach, describe, it } from "mocha"
import "should"
import { buildGateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { shouldRejectFakeFollowupQuestion } from "../fakeFollowupGuard"
import { cacheGateLifecycleDecision } from "../GateLifecycleEvaluator"

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		taskState,
	} as TaskConfig
}

describe("fakeFollowupGuard", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	it("rejects fake follow-up when machine-readable recovery exists", () => {
		const decision = buildGateLifecycleDecision({
			lifecycleState: "finalization_ready",
			activeLane: "finalization",
			reasonCode: "completion.retry_locked",
			operatorMessage: "Use run_finalization",
			engineering: "passed",
			verification: "passed",
			documentation: "pending",
			ledger: "pending",
			finalization: "pending",
			allowedActions: ["run_finalization"],
			forbiddenActions: ["attempt_completion", "ask_followup_question"],
			recoveryPath: [{ order: 1, action: "run_finalization", description: "Finish documentation in this session." }],
			receiptEligible: false,
			moreToolCallsUseful: true,
			userInputRequired: false,
		})
		cacheGateLifecycleDecision(configWithState(taskState), decision)
		const rejection = shouldRejectFakeFollowupQuestion(configWithState(taskState))
		rejection?.should.match(/run_finalization/i)
	})

	it("allows follow-up when user input is required", () => {
		const decision = buildGateLifecycleDecision({
			lifecycleState: "engineering_in_progress",
			activeLane: "completion",
			reasonCode: "engineering.in_progress",
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
