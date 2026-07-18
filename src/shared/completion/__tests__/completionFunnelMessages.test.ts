import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"
import { describe, it } from "mocha"
import { resolveCompletionFunnelSnapshot } from "../completionFunnelMessages"

describe("completion funnel message resolution", () => {
	it("selects one latest event without merging older pending state", () => {
		const messages: DietCodeMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "info",
				completionFunnelEvent: {
					schemaVersion: 1,
					taskId: "task-1",
					phase: "blocked",
					kind: "soft_block",
					terminal: false,
					nextAllowedAction: "modify_workspace",
					forbiddenActions: ["attempt_completion"],
					canonicalInstruction: "Modify workspace.",
					reason: "Old observation.",
					stages: [],
					graphRevision: 1,
					evaluatedAt: 1,
				},
			},
			{ ts: 2, type: "say", say: "completion_result", text: "Done" },
			{ ts: 3, type: "ask", ask: "resume_task" },
		]
		const resolved = resolveCompletionFunnelSnapshot(messages)
		expect(resolved.event).to.equal(undefined)
		expect(resolved.terminalCompletion).to.equal(true)
	})

	it("selects the complete terminal event instead of a newer stale pending projection", () => {
		const terminal = {
			schemaVersion: 1 as const,
			taskId: "task-1",
			phase: "completed" as const,
			kind: "completed" as const,
			terminal: true,
			nextAllowedAction: "none" as const,
			forbiddenActions: ["attempt_completion" as const],
			canonicalInstruction: "Recorded.",
			reason: "Committed.",
			stages: [],
			graphRevision: 2,
			evaluatedAt: 2,
		}
		const messages: DietCodeMessage[] = [
			{ ts: 1, type: "say", say: "completion_result", text: "Done" },
			{ ts: 2, type: "say", say: "info", completionFunnelEvent: terminal },
			{
				ts: 3,
				type: "say",
				say: "info",
				completionFunnelEvent: {
					...terminal,
					phase: "ready",
					kind: "allow_attempt",
					terminal: false,
					nextAllowedAction: "attempt_completion",
					forbiddenActions: [],
				},
			},
		]
		const resolved = resolveCompletionFunnelSnapshot(messages)
		expect(resolved.event).to.deep.equal(terminal)
		expect(resolved.terminalCompletion).to.equal(true)
	})
})
