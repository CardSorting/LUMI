import { beforeEach, describe, it } from "mocha"
import "should"
import { COMPLETION_FUNNEL_SCHEMA_VERSION, type CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { cacheCompletionFunnelEvent } from "../CompletionFunnel"
import { shouldRejectFakeFollowupQuestion } from "../fakeFollowupGuard"

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

	it("rejects fake follow-up when the funnel requires workspace changes", () => {
		const event: CompletionFunnelEvent = {
			schemaVersion: COMPLETION_FUNNEL_SCHEMA_VERSION,
			taskId: "task-1",
			phase: "blocked",
			kind: "soft_block",
			terminal: false,
			nextAllowedAction: "modify_workspace",
			forbiddenActions: ["attempt_completion"],
			canonicalInstruction: "Modify the workspace.",
			reason: "Workspace unchanged.",
			stages: [],
			graphRevision: 1,
			evaluatedAt: Date.now(),
		}
		cacheCompletionFunnelEvent(configWithState(taskState), event)
		const rejection = shouldRejectFakeFollowupQuestion(configWithState(taskState))
		rejection?.should.match(/modify the workspace/i)
	})

	it("allows follow-up when no funnel event exists", () => {
		should(shouldRejectFakeFollowupQuestion(configWithState(taskState))).be.null()
	})
})
