import type { DietCodeSaySubagentStatus } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SubagentExecutionTimeline } from "./SubagentExecutionTimeline"

const baseStatus: DietCodeSaySubagentStatus = {
	status: "running",
	total: 2,
	completed: 1,
	successes: 1,
	failures: 0,
	toolCalls: 3,
	inputTokens: 10,
	outputTokens: 20,
	contextWindow: 200000,
	maxContextTokens: 100,
	maxContextUsagePercentage: 0.05,
	swarmId: "swarm-abc-123",
	continuityMarker: {
		swarmId: "swarm-abc-123",
		taskId: "task-1",
		resumeToken: "swarm-abc-123:1:1",
		lastPersistedAt: Date.now(),
		completedAgents: 1,
		totalAgents: 2,
		status: "running",
	},
	items: [
		{
			id: "a1",
			name: "Agent 1",
			index: 1,
			prompt: "inspect auth",
			status: "completed",
			toolCalls: 2,
			inputTokens: 5,
			outputTokens: 10,
			totalCost: 0.1,
			contextTokens: 50,
			contextWindow: 200000,
			contextUsagePercentage: 0.02,
			evidenceCount: 2,
		},
		{
			id: "a2",
			name: "Agent 2",
			index: 2,
			prompt: "inspect db",
			status: "running",
			toolCalls: 1,
			inputTokens: 5,
			outputTokens: 10,
			totalCost: 0.05,
			contextTokens: 50,
			contextWindow: 200000,
			contextUsagePercentage: 0.02,
			latestToolCall: "read_file(path=src/db.ts)",
		},
	],
}

describe("SubagentExecutionTimeline", () => {
	it("renders swarm continuity and per-agent phases", () => {
		render(<SubagentExecutionTimeline status={baseStatus} />)

		expect(screen.getByText("Execution timeline")).toBeInTheDocument()
		expect(screen.getByText(/swarm:swarm-ab/)).toBeInTheDocument()
		expect(screen.getByText("1/2 agents")).toBeInTheDocument()
		expect(screen.getByText("Completed")).toBeInTheDocument()
		expect(screen.getByText("Tooling")).toBeInTheDocument()
		expect(screen.getByText("2 evidence")).toBeInTheDocument()
	})

	it("surfaces invariant violations", () => {
		render(
			<SubagentExecutionTimeline
				status={{
					...baseStatus,
					invariantViolations: ["missing evidence: no agent preserved evidence references"],
				}}
			/>,
		)

		expect(screen.getByText(/Invariant warnings/)).toBeInTheDocument()
	})
})
