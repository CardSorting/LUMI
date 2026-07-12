import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import * as sinon from "sinon"
import { buildSiblingToolDependencyModel } from "../SiblingToolDependency"
import { SiblingToolScheduler } from "../SiblingToolScheduler"

interface WorkloadOperation {
	label: string
	tool: DietCodeDefaultTool
	durationMs: number
	path?: string
	fails?: boolean
}

interface WorkloadEvidence {
	sequentialEstimateMs: number
	wallClockMs: number
	achievedConcurrency: number
	averageQueueWaitMs: number
	timeToFirstUsefulIoMs: number
	presentationProjectionMs: number
	completionOrder: number[]
	canonicalOrder: number[]
	statuses: string[]
}

function toolBlock(operation: WorkloadOperation, sequence: number): ToolUse {
	return {
		type: "tool_use",
		name: operation.tool,
		params: {
			...(operation.path ? { path: operation.path } : {}),
			...(operation.tool === DietCodeDefaultTool.BASH ? { command: "npm test -- --group unit" } : {}),
		},
		partial: false,
		call_id: `workload-${sequence}`,
	}
}

async function runWorkload(operations: WorkloadOperation[], concurrency = 4): Promise<WorkloadEvidence> {
	const clock = sinon.useFakeTimers({ now: 0 })
	try {
		const blocks = operations.map(toolBlock)
		const nodes = buildSiblingToolDependencyModel(blocks, "/workspace", { invocationPrefix: "performance" })
		const completionOrder: number[] = []
		let active = 0
		let achievedConcurrency = 0
		const scheduler = new SiblingToolScheduler<string>({
			concurrency,
			now: () => clock.now,
			run: (node) => {
				const operation = operations[node.sequence]
				active += 1
				achievedConcurrency = Math.max(achievedConcurrency, active)
				return new Promise<string>((resolve, reject) => {
					setTimeout(() => {
						active -= 1
						completionOrder.push(node.sequence)
						if (operation.fails) {
							reject(new Error(`planned failure: ${operation.label}`))
							return
						}
						resolve(operation.label)
					}, operation.durationMs)
				})
			},
		})

		const execution = scheduler.execute(nodes)
		await clock.runAllAsync()
		const envelopes = await execution
		const firstQueuedAt = Math.min(...envelopes.map((envelope) => envelope.queuedAtMs))
		const lastCompletedAt = Math.max(...envelopes.map((envelope) => envelope.completedAtMs))
		const started = envelopes.filter(
			(envelope): envelope is typeof envelope & { startedAtMs: number } => envelope.startedAtMs !== undefined,
		)
		const queueWaits = started.map((envelope) => envelope.startedAtMs - envelope.queuedAtMs)
		const projectionStartedAt = clock.now
		const canonicalOrder = envelopes.map((envelope) => envelope.sequence)
		const statuses = envelopes.map((envelope) => envelope.status)
		const projectionCompletedAt = clock.now

		return {
			sequentialEstimateMs: operations.reduce((total, operation) => total + operation.durationMs, 0),
			wallClockMs: lastCompletedAt - firstQueuedAt,
			achievedConcurrency,
			averageQueueWaitMs: queueWaits.reduce((total, wait) => total + wait, 0) / queueWaits.length,
			timeToFirstUsefulIoMs: Math.min(...started.map((envelope) => envelope.startedAtMs)) - firstQueuedAt,
			presentationProjectionMs: projectionCompletedAt - projectionStartedAt,
			completionOrder,
			canonicalOrder,
			statuses,
		}
	} finally {
		clock.restore()
	}
}

describe("SiblingToolScheduler deterministic performance workloads", () => {
	it("propagates cooperative cancellation to active and queued work without timer delay", async () => {
		const clock = sinon.useFakeTimers({ now: 0 })
		try {
			const scheduler = new SiblingToolScheduler<string>({
				concurrency: 1,
				now: () => clock.now,
				run: async (_node, signal) =>
					await new Promise<string>((resolve, reject) => {
						const timer = setTimeout(() => resolve("late"), 1_000)
						signal.addEventListener(
							"abort",
							() => {
								clearTimeout(timer)
								reject(new Error("cancelled"))
							},
							{ once: true },
						)
					}),
			})
			const execution = scheduler.execute(
				buildSiblingToolDependencyModel(
					[0, 1, 2].map((sequence) =>
						toolBlock(
							{
								label: `read-${sequence}`,
								tool: DietCodeDefaultTool.FILE_READ,
								path: `src/${sequence}.ts`,
								durationMs: 1_000,
							},
							sequence,
						),
					),
					"/workspace",
				),
			)
			await clock.tickAsync(25)
			const cancelledAt = clock.now
			scheduler.cancel()
			const results = await execution
			const completedAt = Math.max(...results.map((result) => result.completedAtMs))

			assert.equal(completedAt - cancelledAt, 0)
			assert.deepEqual(
				results.map((result) => result.status),
				["cancelled", "cancelled", "cancelled"],
			)
			assert.equal(clock.countTimers(), 0)
		} finally {
			clock.restore()
		}
	})

	it("overlaps four independent file reads and projects out-of-order completions canonically", async () => {
		const evidence = await runWorkload([
			{ label: "read-a", tool: DietCodeDefaultTool.FILE_READ, path: "src/a.ts", durationMs: 100 },
			{ label: "read-b", tool: DietCodeDefaultTool.FILE_READ, path: "src/b.ts", durationMs: 80 },
			{ label: "read-c", tool: DietCodeDefaultTool.FILE_READ, path: "src/c.ts", durationMs: 60 },
			{ label: "read-d", tool: DietCodeDefaultTool.FILE_READ, path: "src/d.ts", durationMs: 40 },
		])

		assert.deepEqual(evidence, {
			sequentialEstimateMs: 280,
			wallClockMs: 100,
			achievedConcurrency: 4,
			averageQueueWaitMs: 0,
			timeToFirstUsefulIoMs: 0,
			presentationProjectionMs: 0,
			completionOrder: [3, 2, 1, 0],
			canonicalOrder: [0, 1, 2, 3],
			statuses: ["succeeded", "succeeded", "succeeded", "succeeded"],
		})
	})

	it("overlaps two reads with two independent repository searches", async () => {
		const evidence = await runWorkload([
			{ label: "read-a", tool: DietCodeDefaultTool.FILE_READ, path: "src/a.ts", durationMs: 90 },
			{ label: "read-b", tool: DietCodeDefaultTool.FILE_READ, path: "src/b.ts", durationMs: 60 },
			{ label: "search-a", tool: DietCodeDefaultTool.SEARCH, path: "src/a", durationMs: 100 },
			{ label: "search-b", tool: DietCodeDefaultTool.SEARCH, path: "src/b", durationMs: 40 },
		])

		assert.deepEqual(evidence, {
			sequentialEstimateMs: 290,
			wallClockMs: 100,
			achievedConcurrency: 4,
			averageQueueWaitMs: 0,
			timeToFirstUsefulIoMs: 0,
			presentationProjectionMs: 0,
			completionOrder: [3, 1, 0, 2],
			canonicalOrder: [0, 1, 2, 3],
			statuses: ["succeeded", "succeeded", "succeeded", "succeeded"],
		})
	})

	it("overlaps a diagnostic with a read-only test command", async () => {
		const evidence = await runWorkload([
			{ label: "diagnostic", tool: DietCodeDefaultTool.STABILITY_DIAGNOSE, durationMs: 80 },
			{ label: "test-command", tool: DietCodeDefaultTool.BASH, durationMs: 140 },
		])

		assert.deepEqual(evidence, {
			sequentialEstimateMs: 220,
			wallClockMs: 140,
			achievedConcurrency: 2,
			averageQueueWaitMs: 0,
			timeToFirstUsefulIoMs: 0,
			presentationProjectionMs: 0,
			completionOrder: [0, 1],
			canonicalOrder: [0, 1],
			statuses: ["succeeded", "succeeded"],
		})
	})

	it("overlaps a mutation with reads of non-conflicting resources", async () => {
		const evidence = await runWorkload([
			{ label: "write-a", tool: DietCodeDefaultTool.FILE_EDIT, path: "src/a.ts", durationMs: 120 },
			{ label: "read-b", tool: DietCodeDefaultTool.FILE_READ, path: "src/b.ts", durationMs: 50 },
			{ label: "read-c", tool: DietCodeDefaultTool.FILE_READ, path: "src/c.ts", durationMs: 60 },
		])

		assert.deepEqual(evidence, {
			sequentialEstimateMs: 230,
			wallClockMs: 120,
			achievedConcurrency: 3,
			averageQueueWaitMs: 0,
			timeToFirstUsefulIoMs: 0,
			presentationProjectionMs: 0,
			completionOrder: [1, 2, 0],
			canonicalOrder: [0, 1, 2],
			statuses: ["succeeded", "succeeded", "succeeded"],
		})
	})

	it("serializes overlapping mutations", async () => {
		const evidence = await runWorkload([
			{ label: "write-a-1", tool: DietCodeDefaultTool.FILE_EDIT, path: "src/a.ts", durationMs: 120 },
			{ label: "write-a-2", tool: DietCodeDefaultTool.APPLY_PATCH, path: "src/a.ts", durationMs: 80 },
		])

		assert.deepEqual(evidence, {
			sequentialEstimateMs: 200,
			wallClockMs: 200,
			achievedConcurrency: 1,
			averageQueueWaitMs: 60,
			timeToFirstUsefulIoMs: 0,
			presentationProjectionMs: 0,
			completionOrder: [0, 1],
			canonicalOrder: [0, 1],
			statuses: ["succeeded", "succeeded"],
		})
	})

	it("retains successful independent results when one sibling fails", async () => {
		const evidence = await runWorkload([
			{ label: "slow-read", tool: DietCodeDefaultTool.FILE_READ, path: "src/a.ts", durationMs: 100 },
			{
				label: "failed-search",
				tool: DietCodeDefaultTool.SEARCH,
				path: "src/missing",
				durationMs: 20,
				fails: true,
			},
			{ label: "successful-search", tool: DietCodeDefaultTool.SEARCH, path: "src", durationMs: 70 },
		])

		assert.deepEqual(evidence, {
			sequentialEstimateMs: 190,
			wallClockMs: 100,
			achievedConcurrency: 3,
			averageQueueWaitMs: 0,
			timeToFirstUsefulIoMs: 0,
			presentationProjectionMs: 0,
			completionOrder: [1, 2, 0],
			canonicalOrder: [0, 1, 2],
			statuses: ["succeeded", "failed", "succeeded"],
		})
	})
})
