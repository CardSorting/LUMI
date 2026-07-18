import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CompletionFunnelStatusPanel } from "./CompletionFunnelStatusPanel"

const event = (overrides: Partial<CompletionFunnelEvent> = {}): CompletionFunnelEvent => ({
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

describe("CompletionFunnelStatusPanel", () => {
	it("renders the sole next action from the funnel event", () => {
		render(<CompletionFunnelStatusPanel event={event()} />)
		expect(screen.getByText("Ready to complete")).toBeInTheDocument()
		expect(screen.getByText("attempt_completion")).toBeInTheDocument()
	})

	it("suppresses every next action after terminal completion", () => {
		render(
			<CompletionFunnelStatusPanel
				event={event({ phase: "blocked", kind: "soft_block", nextAllowedAction: "modify_workspace" })}
				terminalCompletion
			/>,
		)
		expect(screen.getByText("Completed")).toBeInTheDocument()
		expect(screen.queryByText("modify_workspace")).not.toBeInTheDocument()
		expect(screen.getByText(/No completion action remains/)).toBeInTheDocument()
	})

	it("shows the centralized audit trace only in diagnostics mode", () => {
		render(
			<CompletionFunnelStatusPanel
				event={event({ stages: [{ stage: "roadmap", result: "passed", reason: "Ready", decisive: true }] })}
				showInternalDiagnostics
			/>,
		)
		expect(screen.getByText("Funnel audit trace")).toBeInTheDocument()
	})
})
