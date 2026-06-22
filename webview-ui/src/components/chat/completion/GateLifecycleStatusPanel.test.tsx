import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import {
	classifyGateLifecycleFreshness,
	GATE_LIFECYCLE_STALE_MS,
	getGateLifecycleContinuityMarker,
	resolveGateLifecycleSnapshot,
} from "@shared/completion/gateLifecycleMessages"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GateLifecycleStatusPanel } from "./GateLifecycleStatusPanel"

const baseDecision = (overrides: Partial<GateLifecycleDecision>): GateLifecycleDecision => ({
	lifecycleState: "finalization_ready",
	activeLane: "finalization",
	reasonCode: "finalization.ready",
	operatorMessage: "Engineering verified. Run finalization to update documentation in this session.",
	engineering: "passed",
	verification: "passed",
	documentation: "pending",
	ledger: "pending",
	finalization: "pending",
	allowedActions: ["run_finalization"],
	forbiddenActions: ["attempt_completion"],
	recoveryPath: [],
	receiptEligible: false,
	moreToolCallsUseful: true,
	userInputRequired: false,
	evaluatedAt: Date.now(),
	...overrides,
})

describe("gate lifecycle freshness", () => {
	it("classifies current vs stale snapshots", () => {
		const now = 1_000_000
		expect(classifyGateLifecycleFreshness(now - 1_000, now)).toBe("current")
		expect(classifyGateLifecycleFreshness(now - GATE_LIFECYCLE_STALE_MS - 1, now)).toBe("stale")
		expect(classifyGateLifecycleFreshness(undefined, now)).toBe("unknown")
	})

	it("resolves snapshot with continuity marker from messages", () => {
		const decision = baseDecision({ evaluatedAt: 500 })
		const snapshot = resolveGateLifecycleSnapshot(
			[{ ts: 600, type: "say", say: "info", text: "gate", gateLifecycleStatus: decision }],
			{ now: 1_000 },
		)
		expect(snapshot.decision?.lifecycleState).toBe("finalization_ready")
		expect(snapshot.freshness).toBe("current")
		expect(snapshot.continuityMarker).toBe(getGateLifecycleContinuityMarker(decision))
	})

	it("marks stale snapshots from message history", () => {
		const decision = baseDecision({ evaluatedAt: 100 })
		const snapshot = resolveGateLifecycleSnapshot(
			[{ ts: 100, type: "say", say: "info", text: "gate", gateLifecycleStatus: decision }],
			{ now: 100 + GATE_LIFECYCLE_STALE_MS + 1 },
		)
		expect(snapshot.freshness).toBe("stale")
	})
})

describe("GateLifecycleStatusPanel freshness UI", () => {
	it("shows stale warning when freshness is stale", () => {
		render(
			<GateLifecycleStatusPanel
				continuityMarker="gate:finalization.ready:1"
				decision={baseDecision({ evaluatedAt: Date.now() - GATE_LIFECYCLE_STALE_MS - 1 })}
				freshness="stale"
			/>,
		)
		expect(screen.getByText(/Stale snapshot/i)).toBeInTheDocument()
		expect(screen.getByText(/may be outdated/i)).toBeInTheDocument()
		expect(screen.getByText(/Continuity:/i)).toBeInTheDocument()
	})

	it("renders retry-locked finalization lane without failed engineering", () => {
		render(
			<GateLifecycleStatusPanel
				decision={baseDecision({
					lifecycleState: "completion_retry_locked",
					operatorMessage: "Completion retry locked — finalization lane active.",
				})}
				freshness="current"
			/>,
		)
		expect(screen.getByText(/Retry Locked — Recoverable/i)).toBeInTheDocument()
		expect(screen.getByText(/Completion retry-locked — finalization lane active/i)).toBeInTheDocument()
	})

	it("renders sealed receipt terminal success", () => {
		render(
			<GateLifecycleStatusPanel
				decision={baseDecision({
					lifecycleState: "completed_without_retry_completion",
					finalization: "passed",
					documentation: "passed",
					ledger: "passed",
				})}
				freshness="current"
			/>,
		)
		expect(screen.getByText(/Receipt sealed.*session complete/i)).toBeInTheDocument()
	})
})
