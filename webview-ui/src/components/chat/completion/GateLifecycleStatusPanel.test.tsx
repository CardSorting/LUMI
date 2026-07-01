import type { CanonicalLifecycleDecision } from "@shared/completion/canonicalLifecycleDecision"
import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import {
	classifyGateLifecycleFreshness,
	GATE_LIFECYCLE_STALE_MS,
	getGateLifecycleContinuityMarker,
	resolveGateLifecycleSnapshot,
} from "@shared/completion/gateLifecycleMessages"
import { resolveLifecycleProjection } from "@shared/completion/lifecycleProjection"
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

const routeToFinalization: CanonicalLifecycleDecision = {
	kind: "route_to_finalization",
	nextAllowedAction: "run_finalization",
	forbiddenActions: ["attempt_completion"],
	canonicalInstruction: "Call run_finalization now. Do not call attempt_completion.",
	reason: "Engineering verified. Call run_finalization to update documentation and stamp the ledger in this session.",
}

const softBlock: CanonicalLifecycleDecision = {
	kind: "soft_block",
	nextAllowedAction: "modify_workspace",
	forbiddenActions: ["attempt_completion", "run_finalization"],
	canonicalInstruction: "Do not call attempt_completion. Modify the workspace (code changes required), then retry.",
	reason: "Completion blocked: the workspace hasn't changed since the last gate block.",
}

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
		// Use engineering: "pending" so resolveGateLifecycleSnapshot does not
		// force freshness to "current" (which it does when engineering === "passed").
		const decision = baseDecision({ evaluatedAt: 100, engineering: "pending", lifecycleState: "engineering_in_progress" })
		const snapshot = resolveGateLifecycleSnapshot(
			[{ ts: 100, type: "say", say: "info", text: "gate", gateLifecycleStatus: decision }],
			{ now: 100 + GATE_LIFECYCLE_STALE_MS + 1 },
		)
		expect(snapshot.freshness).toBe("stale")
	})
})

describe("GateLifecycleStatusPanel freshness UI", () => {
	it("does not show stale warning for evidence-only legacy when no canonical exists", () => {
		// Stale legacy without canonical is evidence-only — no actionable stale warning
		render(
			<GateLifecycleStatusPanel
				continuityMarker="gate:finalization.ready:1"
				decision={baseDecision({ evaluatedAt: Date.now() - GATE_LIFECYCLE_STALE_MS - 1 })}
				freshness="stale"
			/>,
		)
		expect(screen.queryByText(/may be outdated/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/Continuity:/i)).not.toBeInTheDocument()
	})

	it("renders canonical 'Ready for finalization' label when route_to_finalization is present", () => {
		render(<GateLifecycleStatusPanel canonicalDecision={routeToFinalization} decision={baseDecision()} freshness="current" />)
		expect(screen.getByText("Ready for finalization")).toBeInTheDocument()
		// run_finalization appears in both the canonical instruction and the "Next:" line
		expect(screen.getAllByText(/run_finalization/i).length).toBeGreaterThan(0)
	})

	it("renders canonical 'Blocked' label for hard_block", () => {
		const hardBlock: CanonicalLifecycleDecision = {
			kind: "hard_block",
			nextAllowedAction: "stop_and_report",
			forbiddenActions: ["attempt_completion", "run_finalization"],
			canonicalInstruction:
				"Stop calling attempt_completion. Make workspace changes for a probe attempt, or present results via act_mode_respond.",
			reason: "Maximum completion gate retries exceeded.",
		}
		render(
			<GateLifecycleStatusPanel
				canonicalDecision={hardBlock}
				decision={baseDecision({ lifecycleState: "completion_retry_locked" })}
				freshness="current"
			/>,
		)
		expect(screen.getByText("Blocked")).toBeInTheDocument()
		expect(screen.getByText(/stop_and_report/i)).toBeInTheDocument()
	})

	it("renders canonical 'Workspace changes required' for soft_block", () => {
		const softBlock: CanonicalLifecycleDecision = {
			kind: "soft_block",
			nextAllowedAction: "modify_workspace",
			forbiddenActions: ["attempt_completion", "run_finalization"],
			canonicalInstruction: "Do not call attempt_completion. Modify the workspace (code changes required), then retry.",
			reason: "Completion blocked: the workspace hasn't changed since the last gate block.",
		}
		render(
			<GateLifecycleStatusPanel
				canonicalDecision={softBlock}
				decision={baseDecision({ lifecycleState: "engineering_in_progress" })}
				freshness="current"
			/>,
		)
		expect(screen.getByText("Workspace changes required")).toBeInTheDocument()
		// Must NOT show legacy "Engineering In Progress" label
		expect(screen.queryByText("Engineering In Progress")).not.toBeInTheDocument()
	})

	it("suppresses legacy 'Next: attempt_completion' when canonical says route_to_finalization", () => {
		// Legacy decision says allowedActions: [attempt_completion], but canonical
		// says run_finalization — canonical wins.
		const legacyDecision = baseDecision({
			lifecycleState: "engineering_in_progress",
			allowedActions: ["attempt_completion", "run_verification"],
			forbiddenActions: [],
		})
		render(<GateLifecycleStatusPanel canonicalDecision={routeToFinalization} decision={legacyDecision} freshness="current" />)
		// Must show run_finalization in the Next: line, NOT attempt_completion
		const nextLine = screen.getByText(/Next:/i).closest("div")
		expect(nextLine?.textContent).toContain("run_finalization")
		expect(nextLine?.textContent).not.toContain("attempt_completion")
	})

	it("does not render legacy-only lifecycle guidance by default", () => {
		const { container } = render(<GateLifecycleStatusPanel decision={baseDecision()} freshness="current" />)
		expect(container).toBeEmptyDOMElement()
	})

	it("labels legacy evidence as internal diagnostics in explicit debug mode", () => {
		render(
			<GateLifecycleStatusPanel
				continuityMarker="gate:preflight.quality:123"
				decision={baseDecision()}
				freshness="current"
				showInternalDiagnostics
			/>,
		)
		expect(screen.getByText("Internal diagnostics")).toBeInTheDocument()
		expect(screen.getByText(/Continuity:/i)).toBeInTheDocument()
	})
})

describe("lifecycle projection resolver", () => {
	it("canonical route_to_finalization suppresses legacy Next: attempt_completion", () => {
		const projection = resolveLifecycleProjection({
			canonicalDecision: routeToFinalization,
			legacyDecision: baseDecision({
				allowedActions: ["attempt_completion"],
			}),
			freshness: "current",
		})
		expect(projection.source).toBe("canonical_spine")
		expect(projection.nextAction).toBe("run_finalization")
		expect(projection.statusLabel).toBe("Ready for finalization")
	})

	it("canonical soft_block shows 'Workspace changes required'", () => {
		const projection = resolveLifecycleProjection({
			canonicalDecision: {
				kind: "soft_block",
				nextAllowedAction: "modify_workspace",
				forbiddenActions: ["attempt_completion", "run_finalization"],
				canonicalInstruction: "Modify the workspace.",
				reason: "Workspace unchanged.",
			},
			legacyDecision: baseDecision({ lifecycleState: "engineering_in_progress" }),
			freshness: "current",
		})
		expect(projection.statusLabel).toBe("Workspace changes required")
		expect(projection.nextAction).toBe("modify_workspace")
	})

	it("canonical hard_block shows 'Blocked'", () => {
		const projection = resolveLifecycleProjection({
			canonicalDecision: {
				kind: "hard_block",
				nextAllowedAction: "stop_and_report",
				forbiddenActions: ["attempt_completion", "run_finalization"],
				canonicalInstruction: "Stop and report.",
				reason: "Circuit breaker tripped.",
			},
			legacyDecision: baseDecision({ lifecycleState: "completion_retry_locked" }),
			freshness: "current",
		})
		expect(projection.statusLabel).toBe("Blocked")
		expect(projection.nextAction).toBe("stop_and_report")
	})

	it("legacy projection only appears when canonical decision is absent", () => {
		const projection = resolveLifecycleProjection({
			legacyDecision: baseDecision({ lifecycleState: "engineering_in_progress" }),
			freshness: "current",
		})
		expect(projection.source).toBe("legacy_gate")
		expect(projection.statusLabel).toBe("Ready to complete")
	})

	it("no decision at all falls back to fallback source", () => {
		const projection = resolveLifecycleProjection({
			freshness: "unknown",
		})
		expect(projection.source).toBe("fallback")
		expect(projection.statusLabel).toBe("Ready to complete")
	})
})

describe("regression hardening — completed task progress vs stale legacy UI", () => {
	it("completed checklist + stale legacy does not render 'Engineering In Progress'", () => {
		render(
			<GateLifecycleStatusPanel
				checklistComplete
				decision={baseDecision({
					lifecycleState: "engineering_in_progress",
					engineering: "pending",
					allowedActions: ["attempt_completion", "run_verification"],
				})}
				freshness="stale"
			/>,
		)
		expect(screen.queryByText("Engineering In Progress")).not.toBeInTheDocument()
		// Must not show legacy Next: attempt_completion
		expect(screen.queryByText(/Next:/i)?.textContent ?? "").not.toContain("attempt_completion")
	})

	it("completed checklist suppresses legacy 'Next: attempt_completion, run_verification'", () => {
		render(
			<GateLifecycleStatusPanel
				checklistComplete
				decision={baseDecision({
					allowedActions: ["attempt_completion", "run_verification"],
				})}
				freshness="current"
			/>,
		)
		// No "Next:" line should be rendered
		expect(screen.queryByText(/Next:/i)).not.toBeInTheDocument()
	})

	it("canonical decision with stale legacy renders canonical status, not stale warning", () => {
		render(
			<GateLifecycleStatusPanel
				canonicalDecision={routeToFinalization}
				decision={baseDecision({ lifecycleState: "engineering_in_progress" })}
				freshness="stale"
			/>,
		)
		expect(screen.getByText("Ready for finalization")).toBeInTheDocument()
		// Must NOT show stale warning when canonical exists
		expect(screen.queryByText(/may be outdated/i)).not.toBeInTheDocument()
	})

	it("GateLifecycleStatusPanel scopes Next: exclusively to canonical projection", () => {
		render(
			<GateLifecycleStatusPanel
				canonicalDecision={routeToFinalization}
				decision={baseDecision({
					allowedActions: ["attempt_completion", "run_verification"],
				})}
				freshness="current"
			/>,
		)
		// Next: line must contain run_finalization (from canonical), NOT attempt_completion
		const nextLine = screen.getByText(/Next:/i).closest("div")
		expect(nextLine?.textContent).toContain("run_finalization")
		expect(nextLine?.textContent).not.toContain("attempt_completion")
	})

	it("no COGNITIVE REFLECTION or breather nudge text in rendered output", () => {
		const { container } = render(
			<GateLifecycleStatusPanel
				canonicalDecision={softBlock}
				decision={baseDecision({ lifecycleState: "engineering_in_progress" })}
				freshness="current"
			/>,
		)
		const text = container.textContent ?? ""
		expect(text).not.toMatch(/COGNITIVE REFLECTION/i)
		expect(text).not.toMatch(/breather nudge/i)
		expect(text).not.toMatch(/taking a breather/i)
	})

	it("sanitizes canonical projection fields before rendering", () => {
		const { container } = render(
			<GateLifecycleStatusPanel
				canonicalDecision={{
					...routeToFinalization,
					canonicalInstruction:
						"COGNITIVE REFLECTION\nHealth: 1%\n<completion_gate_envelope>internal</completion_gate_envelope>",
				}}
				decision={baseDecision()}
				freshness="current"
			/>,
		)
		const text = container.textContent ?? ""
		expect(text).toContain("run_finalization")
		expect(text).not.toMatch(/COGNITIVE REFLECTION|Health:|completion_gate_envelope/i)
	})
})
