import { diffSubagentStatuses } from "@shared/execution/statusDiff"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SubagentCompactionBoundary } from "./SubagentCompactionBoundary"
import { SubagentExecutionDiffViewer } from "./SubagentExecutionDiffViewer"

describe("SubagentCompactionBoundary", () => {
	it("displays compaction warnings and transcript count", () => {
		render(
			<SubagentCompactionBoundary
				entry={{
					id: "a1",
					name: "Agent",
					index: 1,
					prompt: "p",
					status: "completed",
					toolCalls: 1,
					inputTokens: 1,
					outputTokens: 1,
					totalCost: 0,
					contextTokens: 1,
					contextWindow: 1000,
					contextUsagePercentage: 1,
					compactionWarnings: ["Compaction proactive_threshold: dropped 0-2 (risk medium)"],
					transcriptEventCount: 4,
				}}
			/>,
		)

		expect(screen.getByText("Compaction boundary")).toBeInTheDocument()
		expect(screen.getByText(/Transcript events preserved: 4/)).toBeInTheDocument()
	})
})

describe("SubagentExecutionDiffViewer", () => {
	it("renders changed agent status and transcript delta", () => {
		const left = {
			status: "failed" as const,
			total: 1,
			completed: 1,
			successes: 0,
			failures: 1,
			toolCalls: 1,
			inputTokens: 1,
			outputTokens: 1,
			contextWindow: 1000,
			maxContextTokens: 10,
			maxContextUsagePercentage: 1,
			swarmId: "swarm-a",
			items: [
				{
					id: "a1",
					name: "Agent",
					index: 1,
					prompt: "p",
					status: "failed" as const,
					toolCalls: 1,
					inputTokens: 1,
					outputTokens: 1,
					totalCost: 0,
					contextTokens: 1,
					contextWindow: 1000,
					contextUsagePercentage: 1,
					transcriptEventCount: 2,
				},
			],
		}
		const right = {
			...left,
			status: "completed" as const,
			successes: 1,
			failures: 0,
			swarmId: "swarm-b",
			items: [{ ...left.items[0], status: "completed" as const, transcriptEventCount: 5, result: "ok" }],
		}

		render(<SubagentExecutionDiffViewer diff={diffSubagentStatuses(left, right)} leftLabel="swarm-a" rightLabel="swarm-b" />)

		expect(screen.getByText(/Execution diff/)).toBeInTheDocument()
		expect(screen.getByText(/transcript delta 3/i)).toBeInTheDocument()
	})

	it("shows corruption error visibly", () => {
		render(
			<SubagentExecutionDiffViewer
				diff={diffSubagentStatuses(
					{
						status: "failed",
						total: 0,
						completed: 0,
						successes: 0,
						failures: 0,
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						contextWindow: 0,
						maxContextTokens: 0,
						maxContextUsagePercentage: 0,
						items: [],
					},
					{
						status: "completed",
						total: 0,
						completed: 0,
						successes: 0,
						failures: 0,
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						contextWindow: 0,
						maxContextTokens: 0,
						maxContextUsagePercentage: 0,
						items: [],
					},
				)}
				error="checksum mismatch"
				leftLabel="a"
				rightLabel="b"
			/>,
		)

		expect(screen.getByText(/Diff unavailable: checksum mismatch/)).toBeInTheDocument()
	})
})
