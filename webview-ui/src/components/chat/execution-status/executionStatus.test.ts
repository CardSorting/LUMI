import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import type { ResolvedCompletionFunnelSnapshot } from "@shared/completion/completionFunnelMessages"
import type { DietCodeMessage, TaskAuditMetadata } from "@shared/ExtensionMessage"
import type { TaskLifecycleEvent } from "@shared/lifecycle/taskLifecycleEvent"
import { describe, expect, it } from "vitest"
import { deriveExecutionStatus } from "./executionStatus"

const task: DietCodeMessage = { ts: 1, type: "say", say: "task", text: "Update the project" }
const funnelEvent = (overrides: Partial<CompletionFunnelEvent> = {}): CompletionFunnelEvent => ({
	schemaVersion: 1,
	taskId: "task-1",
	phase: "ready",
	kind: "allow_attempt",
	terminal: false,
	nextAllowedAction: "attempt_completion",
	forbiddenActions: [],
	canonicalInstruction: "Attempt completion.",
	reason: "Ready.",
	stages: [],
	graphRevision: 1,
	evaluatedAt: 1,
	...overrides,
})
const completedLifecycleEvent: TaskLifecycleEvent = {
	schemaVersion: 1,
	eventId: "lifecycle-event-1",
	intentId: "lifecycle-intent-1",
	taskId: "task-1",
	generationId: "generation-1",
	lifecycleRevision: 3,
	transition: "settle_completion",
	previous: {
		generationId: "generation-1",
		lifecycleRevision: 2,
		state: "active",
		cancellation: { status: "none" },
		lastEventId: "lifecycle-event-0",
		committedAt: 1,
		monotonicSequence: 2,
	},
	committed: {
		generationId: "generation-1",
		lifecycleRevision: 3,
		state: "terminal",
		terminalOutcome: "completed",
		cancellation: { status: "none" },
		lastEventId: "lifecycle-event-1",
		committedAt: 2,
		monotonicSequence: 3,
	},
	terminalOutcome: "completed",
	cause: { source: "completion_funnel", reason: "Durable completion committed." },
	committedAt: 2,
	monotonicSequence: 3,
}
const cancelledLifecycleEvent: TaskLifecycleEvent = {
	...completedLifecycleEvent,
	eventId: "lifecycle-cancelled-1",
	intentId: "lifecycle-cancel-intent-1",
	transition: "settle_cancellation",
	committed: {
		...completedLifecycleEvent.committed,
		terminalOutcome: "cancelled",
		cancellation: {
			status: "requested",
			requestedAt: 1,
			requestEventId: "lifecycle-cancel-request-1",
			requestIntentId: "lifecycle-cancel-request-intent-1",
		},
		lastEventId: "lifecycle-cancelled-1",
	},
	terminalOutcome: "cancelled",
	cause: { source: "controller", reason: "Cancellation resources settled." },
}

describe("deriveExecutionStatus", () => {
	it("makes a pending approval the primary state", () => {
		const approval: DietCodeMessage = {
			ts: 2,
			type: "ask",
			ask: "command",
			text: "npm test",
		}

		const result = deriveExecutionStatus({ messages: [task, approval] })

		expect(result.state).toBe("approval")
		expect(result.title).toBe("Approval required")
		expect(result.nextAction).toContain("approve or decline")
	})

	it("shows active streaming work as running", () => {
		const partial: DietCodeMessage = { ts: 2, type: "say", say: "text", text: "Working", partial: true }

		const result = deriveExecutionStatus({ messages: [task, partial] })

		expect(result.state).toBe("running")
		expect(result.confidence).toBe("Pending")
	})

	it("uses lifecycle cancellation rather than inferring it from an API message", () => {
		const cancelled: DietCodeMessage = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ cancelReason: "user_cancelled" }),
		}
		const recovering: DietCodeMessage = { ts: 3, type: "say", say: "api_req_retried", text: "Retrying" }

		expect(deriveExecutionStatus({ messages: [task, cancelled] }).state).not.toBe("cancelled")
		expect(
			deriveExecutionStatus({
				messages: [task, cancelled],
				lifecycleEvent: cancelledLifecycleEvent,
			}).state,
		).toBe("cancelled")
		expect(deriveExecutionStatus({ messages: [task, recovering] }).state).toBe("recovering")
	})

	it("shows a blocked funnel as workspace changes required", () => {
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: false,
			event: funnelEvent({
				phase: "blocked",
				kind: "soft_block",
				nextAllowedAction: "modify_workspace",
				reason: "Workspace unchanged.",
			}),
		}

		const result = deriveExecutionStatus({ messages: [task], completionFunnel })
		expect(result.state).toBe("blocked")
		expect(result.title).toContain("Workspace changes")
	})

	it("uses the lifecycle commit rather than an older non-terminal completion projection", () => {
		const completion: DietCodeMessage = { ts: 2, type: "ask", ask: "completion_result", text: "Done" }
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: true,
			event: funnelEvent({ phase: "blocked", kind: "soft_block", nextAllowedAction: "modify_workspace" }),
		}

		const result = deriveExecutionStatus({
			messages: [task, completion],
			completionFunnel,
			lifecycleEvent: completedLifecycleEvent,
		})
		expect(result.state).toBe("complete")
		expect(result.confidence).toBe("Recorded")
	})

	it("does not present a partial governed receipt as complete", () => {
		const receipt: DietCodeMessage = {
			ts: 2,
			type: "say",
			say: "subagent",
			text: JSON.stringify({
				items: [],
				governedReceipt: { diagnostics: { incident: "partial_receipt", retrySafe: false } },
			}),
		}

		const result = deriveExecutionStatus({ messages: [task, receipt] })
		expect(result.state).toBe("blocked")
		expect(result.nextAction).toContain("Do not retry")
	})

	it("does not let a stale partial receipt demote a terminal funnel event", () => {
		const receipt: DietCodeMessage = {
			ts: 2,
			type: "say",
			say: "subagent",
			text: JSON.stringify({
				items: [],
				governedReceipt: { diagnostics: { incident: "partial_receipt", retrySafe: false } },
			}),
		}
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: true,
			event: funnelEvent({ phase: "completed", kind: "completed", terminal: true, nextAllowedAction: "none" }),
		}

		const result = deriveExecutionStatus({
			messages: [task, receipt],
			completionFunnel,
			lifecycleEvent: completedLifecycleEvent,
		})
		expect(result.state).toBe("complete")
		expect(result.confidence).toBe("Recorded")
	})

	it("renders failed quality gate metadata as advisory without overriding completion", () => {
		const completion: DietCodeMessage = { ts: 2, type: "ask", ask: "completion_result", text: "Done" }
		const auditMetadata = { gate_blocked: true, violations: ["critical:test"] } as TaskAuditMetadata

		const result = deriveExecutionStatus({
			messages: [task, completion],
			auditMetadata,
			lifecycleEvent: completedLifecycleEvent,
		})

		expect(result.state).toBe("complete")
		expect(result.safety).toBe("Advisory findings")
		expect(result.confidence).toBe("Recorded")
	})

	it("reports recorded confidence from a terminal funnel event", () => {
		const completion: DietCodeMessage = { ts: 2, type: "ask", ask: "completion_result", text: "Done" }
		const auditHealth: AuditHealthSummary = {
			snapshotCount: 1,
			averageScore: 96,
			criticalViolationCount: 0,
			warningViolationCount: 0,
			gateBlockCount: 0,
			advisorySnapshotCount: 0,
			suppressedViolationCount: 0,
			persistentViolationCount: 0,
			latestScoreDelta: undefined,
			trailingGateBlockStreak: 0,
			planRegressionDetected: false,
			trend: "stable",
		}
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: true,
			event: funnelEvent({
				phase: "completed",
				kind: "completed",
				terminal: true,
				nextAllowedAction: "none",
			}),
		}

		const result = deriveExecutionStatus({
			messages: [task, completion],
			auditHealth,
			completionFunnel,
			lifecycleEvent: completedLifecycleEvent,
		})

		expect(result.state).toBe("complete")
		expect(result.safety).toBe("Passed")
		expect(result.confidence).toBe("Recorded")
	})

	it("does not let a generic resume marker overturn a recorded completion result", () => {
		const completion: DietCodeMessage = { ts: 2, type: "say", say: "completion_result", text: "Done" }
		const progress: DietCodeMessage = { ts: 3, type: "say", say: "task_progress", text: "- [x] Done" }
		const resume: DietCodeMessage = { ts: 4, type: "ask", ask: "resume_task" }

		const result = deriveExecutionStatus({
			messages: [task, completion, progress, resume],
			lifecycleEvent: completedLifecycleEvent,
		})

		expect(result.state).toBe("complete")
		expect(result.title).toBe("Execution complete")
		expect(result.confidence).toBe("Recorded")
		expect(result.nextAction).toContain("start a new task")
	})

	it("lets terminal evidence supersede an older non-terminal funnel observation", () => {
		const completion: DietCodeMessage = { ts: 3, type: "say", say: "completion_result", text: "Done" }
		const resume: DietCodeMessage = { ts: 4, type: "ask", ask: "resume_task" }
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: true,
			event: funnelEvent({ phase: "ready" }),
		}

		const result = deriveExecutionStatus({
			messages: [task, completion, resume],
			completionFunnel,
			lifecycleEvent: completedLifecycleEvent,
		})

		expect(result.state).toBe("complete")
		expect(result.confidence).not.toBe("Pending")
	})

	it("does not synthesize terminal lifecycle state from transcript completion evidence", () => {
		const completion: DietCodeMessage = { ts: 2, type: "say", say: "completion_result", text: "Done" }
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: true,
			event: funnelEvent({ phase: "completed", kind: "completed", terminal: true, nextAllowedAction: "none" }),
		}
		const result = deriveExecutionStatus({ messages: [task, completion], completionFunnel })
		expect(result.state).not.toBe("complete")
		expect(result.confidence).not.toBe("Recorded")
	})

	it("sanitizes funnel reasons before rendering guidance", () => {
		const completionFunnel: ResolvedCompletionFunnelSnapshot = {
			terminalCompletion: false,
			event: funnelEvent({
				phase: "failed",
				kind: "hard_block",
				nextAllowedAction: "stop_and_report",
				reason: "COGNITIVE REFLECTION — take a breather nudge",
			}),
		}

		const result = deriveExecutionStatus({ messages: [task], completionFunnel })
		const rendered = Object.values(result).join(" ")
		expect(rendered).not.toMatch(/COGNITIVE REFLECTION|breather nudge|run_verification/i)
	})

	it("returns 'Stopped' safety label when execution is cancelled", () => {
		const result = deriveExecutionStatus({
			messages: [task],
			lifecycleEvent: cancelledLifecycleEvent,
		})
		expect(result.state).toBe("cancelled")
		expect(result.safety).toBe("Stopped")
	})

	it("returns 'Failed' safety label when execution is failed", () => {
		const failedLifecycleEvent: TaskLifecycleEvent = {
			...completedLifecycleEvent,
			eventId: "lifecycle-failed-1",
			intentId: "lifecycle-fail-intent-1",
			transition: "settle_failure",
			committed: {
				...completedLifecycleEvent.committed,
				terminalOutcome: "failed",
				lastEventId: "lifecycle-failed-1",
			},
			terminalOutcome: "failed",
			cause: { source: "controller", reason: "Failure settled." },
		}

		const result = deriveExecutionStatus({
			messages: [task],
			lifecycleEvent: failedLifecycleEvent,
		})
		expect(result.state).toBe("failed")
		expect(result.safety).toBe("Failed")
	})
})
