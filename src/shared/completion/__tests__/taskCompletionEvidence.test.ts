import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { describe, it } from "mocha"
import should from "should"
import { getTerminalCompletionEvidence, resolveTaskResumeAsk } from "../taskCompletionEvidence"

const task: DietCodeMessage = { ts: 1, type: "say", say: "task", text: "Do the work" }

describe("terminal completion evidence", () => {
	it("keeps a completed result terminal when history appends a generic resume marker", () => {
		const messages: DietCodeMessage[] = [
			task,
			{ ts: 2, type: "say", say: "completion_result", text: "Done" },
			{ ts: 3, type: "say", say: "task_progress", text: "- [x] Done" },
			{ ts: 4, type: "ask", ask: "resume_task" },
		]

		should(getTerminalCompletionEvidence(messages)?.source).equal("completion_result")
		should(resolveTaskResumeAsk(messages)).equal("resume_completed_task")
	})

	it("recognizes a terminal funnel event even without a completion-result ask", () => {
		const messages: DietCodeMessage[] = [
			task,
			{
				ts: 2,
				type: "say",
				say: "info",
				completionFunnelEvent: {
					schemaVersion: 1,
					taskId: "task-1",
					phase: "completed",
					kind: "completed",
					terminal: true,
					nextAllowedAction: "none",
					forbiddenActions: ["attempt_completion"],
					canonicalInstruction: "Complete.",
					reason: "Committed.",
					stages: [],
					graphRevision: 1,
					evaluatedAt: 2,
				},
			},
		]

		should(getTerminalCompletionEvidence(messages)?.source).equal("completion_funnel")
		should(resolveTaskResumeAsk(messages)).equal("resume_completed_task")
	})

	it("uses durable success as the authoritative resume state", () => {
		should(resolveTaskResumeAsk([task, { ts: 2, type: "ask", ask: "resume_task" }], "succeeded")).equal(
			"resume_completed_task",
		)
	})

	it("allows explicit user feedback and a new model turn to reopen a completed task", () => {
		const messages: DietCodeMessage[] = [
			task,
			{ ts: 2, type: "say", say: "completion_result", text: "Done" },
			{ ts: 3, type: "say", say: "user_feedback", text: "Please change one more thing" },
			{ ts: 4, type: "say", say: "api_req_started", text: "{}" },
		]

		should(getTerminalCompletionEvidence(messages)).be.undefined()
		should(resolveTaskResumeAsk(messages)).equal("resume_task")
	})

	it("does not turn failed or cancelled durable outcomes into successful completion", () => {
		should(resolveTaskResumeAsk([task], "failed")).equal("resume_task")
		should(resolveTaskResumeAsk([task], "cancelled")).equal("resume_task")
	})
})
