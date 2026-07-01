import type { AuditHealthSummary } from "@shared/audit/auditRollup"
import type { ResolvedGateLifecycleSnapshot } from "@shared/completion/gateLifecycleMessages"
import type { DietCodeMessage, TaskAuditMetadata } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { deriveExecutionStatus } from "./executionStatus"

const task: DietCodeMessage = { ts: 1, type: "say", say: "task", text: "Update the project" }

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

	it("distinguishes cancelled and recovering execution", () => {
		const cancelled: DietCodeMessage = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ cancelReason: "user_cancelled" }),
		}
		const recovering: DietCodeMessage = { ts: 3, type: "say", say: "api_req_retried", text: "Retrying" }

		expect(deriveExecutionStatus({ messages: [task, cancelled] }).state).toBe("cancelled")
		expect(deriveExecutionStatus({ messages: [task, recovering] }).state).toBe("recovering")
	})

	it("keeps retry-locked finalization visibly in progress", () => {
		const gateLifecycle = {
			freshness: "current",
			decision: { lifecycleState: "completion_retry_locked" },
		} as ResolvedGateLifecycleSnapshot

		const result = deriveExecutionStatus({ messages: [task], gateLifecycle })
		expect(result.state).toBe("recovering")
		expect(result.title).toContain("retry-locked")
	})

	it("blocks completion when the gate snapshot is stale", () => {
		const completion: DietCodeMessage = { ts: 2, type: "ask", ask: "completion_result", text: "Done" }
		const gateLifecycle = {
			freshness: "stale",
			decision: { lifecycleState: "engineering_verified" },
		} as ResolvedGateLifecycleSnapshot

		const result = deriveExecutionStatus({ messages: [task, completion], gateLifecycle })
		expect(result.state).toBe("complete")
		expect(result.safety).toBe("Snapshot stale")
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

	it("renders failed quality gate metadata as advisory without overriding completion", () => {
		const completion: DietCodeMessage = { ts: 2, type: "ask", ask: "completion_result", text: "Done" }
		const auditMetadata = { gate_blocked: true, violations: ["critical:test"] } as TaskAuditMetadata

		const result = deriveExecutionStatus({ messages: [task, completion], auditMetadata })

		expect(result.state).toBe("complete")
		expect(result.safety).toBe("Advisory findings")
		expect(result.confidence).toBe("Reported complete")
	})

	it("reports sealed completion confidence from a current receipt", () => {
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
		const gateLifecycle = {
			freshness: "current",
			decision: { completionReceipt: { receiptId: "receipt-1" } },
		} as ResolvedGateLifecycleSnapshot

		const result = deriveExecutionStatus({ messages: [task, completion], auditHealth, gateLifecycle })

		expect(result.state).toBe("complete")
		expect(result.safety).toBe("Active")
		expect(result.confidence).toBe("Receipt sealed")
	})
})
