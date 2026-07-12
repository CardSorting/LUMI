import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import { buildSiblingToolDependencyModel, type SiblingToolDependencyNode } from "../SiblingToolDependency"
import { SiblingToolScheduler } from "../SiblingToolScheduler"

interface Deferred<T> {
	promise: Promise<T>
	resolve(value: T): void
	reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

function tool(name: DietCodeDefaultTool, params: ToolUse["params"], callId?: string): ToolUse {
	return {
		type: "tool_use",
		name,
		params,
		partial: false,
		call_id: callId,
	}
}

function readNodes(count: number): SiblingToolDependencyNode[] {
	return buildSiblingToolDependencyModel(
		Array.from({ length: count }, (_, sequence) =>
			tool(DietCodeDefaultTool.FILE_READ, { path: `src/file-${sequence}.ts` }, `read-${sequence}`),
		),
		"/workspace",
	)
}

describe("SiblingToolScheduler", () => {
	it("starts independent reads before the first sibling completes", async () => {
		const gates = [deferred<string>(), deferred<string>()]
		const started: number[] = []
		const bothStarted = deferred<void>()
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 2,
			run: async (node) => {
				started.push(node.sequence)
				if (started.length === 2) bothStarted.resolve()
				return gates[node.sequence].promise
			},
		})

		const execution = scheduler.execute(readNodes(2))
		await bothStarted.promise
		assert.deepEqual(started, [0, 1])
		gates[0].resolve("a")
		gates[1].resolve("b")

		assert.deepEqual(
			(await execution).map((result) => result.value),
			["a", "b"],
		)
	})

	it("serializes overlapping writes", async () => {
		const firstGate = deferred<string>()
		const secondGate = deferred<string>()
		const secondStarted = deferred<void>()
		const started: number[] = []
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_NEW, { path: "src/shared.ts", content: "one" }),
				tool(DietCodeDefaultTool.FILE_EDIT, { path: "src/shared.ts", diff: "two" }),
			],
			"/workspace",
		)
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 2,
			run: async (node) => {
				started.push(node.sequence)
				if (node.sequence === 1) secondStarted.resolve()
				return node.sequence === 0 ? firstGate.promise : secondGate.promise
			},
		})

		const execution = scheduler.execute(nodes)
		await flushMicrotasks()
		assert.deepEqual(started, [0])
		firstGate.resolve("first")
		await secondStarted.promise
		assert.deepEqual(started, [0, 1])
		secondGate.resolve("second")
		assert.deepEqual(
			(await execution).map((result) => result.status),
			["succeeded", "succeeded"],
		)
	})

	it("waits for an explicit prerequisite while starting an unrelated sibling", async () => {
		const producerGate = deferred<string>()
		const dependentGate = deferred<string>()
		const unrelatedGate = deferred<string>()
		const producer = tool(DietCodeDefaultTool.FILE_READ, { path: "src/source.ts" }, "producer")
		const dependent = {
			...tool(DietCodeDefaultTool.SEARCH, { path: "src", regex: "export" }, "dependent"),
			depends_on: ["producer"],
		} as ToolUse & { depends_on: string[] }
		const unrelated = tool(DietCodeDefaultTool.FILE_READ, { path: "README.md" }, "unrelated")
		const nodes = buildSiblingToolDependencyModel([producer, dependent, unrelated], "/workspace")
		const started: number[] = []
		const dependentStarted = deferred<void>()
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 3,
			run: async (node) => {
				started.push(node.sequence)
				if (node.sequence === 1) dependentStarted.resolve()
				return [producerGate, dependentGate, unrelatedGate][node.sequence].promise
			},
		})

		const execution = scheduler.execute(nodes)
		await flushMicrotasks()
		assert.deepEqual(started, [0, 2])
		producerGate.resolve("producer-result")
		await dependentStarted.promise
		assert.deepEqual(started, [0, 2, 1])
		dependentGate.resolve("dependent-result")
		unrelatedGate.resolve("unrelated-result")
		await execution
	})

	it("waits for a prerequisite mutation whose result it references", async () => {
		const mutationGate = deferred<string>()
		const readGate = deferred<string>()
		const readStarted = deferred<void>()
		const mutation = tool(
			DietCodeDefaultTool.FILE_NEW,
			{ path: "generated/output.ts", content: "export const value = 1" },
			"mutation-result",
		)
		const dependentRead = tool(DietCodeDefaultTool.SEARCH, { path: "src", regex: "$mutation-result" }, "dependent-read")
		const nodes = buildSiblingToolDependencyModel([mutation, dependentRead], "/workspace")
		const started: number[] = []
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 2,
			run: async (node) => {
				started.push(node.sequence)
				if (node.sequence === 1) readStarted.resolve()
				return node.sequence === 0 ? mutationGate.promise : readGate.promise
			},
		})

		assert.equal(nodes[1].dependencyEdges[0]?.reason, "result-reference")
		const execution = scheduler.execute(nodes)
		await flushMicrotasks()
		assert.deepEqual(started, [0])
		mutationGate.resolve("mutation complete")
		await readStarted.promise
		assert.deepEqual(started, [0, 1])
		readGate.resolve("fresh read")
		await execution
	})

	it("returns canonical emission order when execution completes in reverse order", async () => {
		const gates = readNodes(4).map(() => deferred<string>())
		const completionOrder: number[] = []
		const allStarted = deferred<void>()
		let started = 0
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 4,
			run: async (node) => {
				started++
				if (started === 4) allStarted.resolve()
				const value = await gates[node.sequence].promise
				completionOrder.push(node.sequence)
				return value
			},
		})

		const execution = scheduler.execute(readNodes(4))
		await allStarted.promise
		for (let sequence = 3; sequence >= 0; sequence--) {
			gates[sequence].resolve(`result-${sequence}`)
			await flushMicrotasks()
		}
		const results = await execution

		assert.deepEqual(completionOrder, [3, 2, 1, 0])
		assert.deepEqual(
			results.map((result) => result.sequence),
			[0, 1, 2, 3],
		)
		assert.deepEqual(
			results.map((result) => result.value),
			["result-0", "result-1", "result-2", "result-3"],
		)
	})

	it("cancels the active operation and all queued siblings", async () => {
		const activeStarted = deferred<void>()
		let observedAbort = false
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 1,
			run: async (_node, signal) => {
				activeStarted.resolve()
				return new Promise<string>((_resolve, reject) => {
					const abort = () => {
						observedAbort = true
						reject(new Error("aborted"))
					}
					if (signal.aborted) abort()
					else signal.addEventListener("abort", abort, { once: true })
				})
			},
		})

		const execution = scheduler.execute(readNodes(3))
		await activeStarted.promise
		scheduler.cancel()
		const results = await execution

		assert.equal(observedAbort, true)
		assert.deepEqual(
			results.map((result) => result.status),
			["cancelled", "cancelled", "cancelled"],
		)
		assert.equal(results.filter((result) => result.startedAtMs !== undefined).length, 1)
	})

	it("preserves successful independent results when one sibling fails", async () => {
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 3,
			run: async (node) => {
				if (node.sequence === 1) throw new Error("query failed")
				return `result-${node.sequence}`
			},
		})

		const results = await scheduler.execute(readNodes(3))

		assert.deepEqual(
			results.map((result) => result.status),
			["succeeded", "failed", "succeeded"],
		)
		assert.deepEqual(
			results.map((result) => result.value),
			["result-0", undefined, "result-2"],
		)
		assert.equal(results[1].error, "query failed")
	})

	it("skips only a dependent when a completed tool returns a semantic failure envelope", async () => {
		const producer = tool(DietCodeDefaultTool.FILE_READ, { path: "src/source.ts" }, "producer")
		const dependent = {
			...tool(DietCodeDefaultTool.SEARCH, { path: "src", regex: "needle" }, "dependent"),
			depends_on: ["producer"],
		} as ToolUse & { depends_on: string[] }
		const unrelated = tool(DietCodeDefaultTool.FILE_READ, { path: "README.md" }, "unrelated")
		const scheduler = new SiblingToolScheduler<{ outcome: "succeeded" | "failed"; value: string }>({
			concurrency: 3,
			classifyResult: (value) => ({ status: value.outcome, error: value.outcome === "failed" ? value.value : undefined }),
			run: async (node) => ({
				outcome: node.sequence === 0 ? "failed" : "succeeded",
				value: node.sequence === 0 ? "query failed" : `result-${node.sequence}`,
			}),
		})

		const results = await scheduler.execute(buildSiblingToolDependencyModel([producer, dependent, unrelated], "/workspace"))
		assert.deepEqual(
			results.map((result) => result.status),
			["failed", "skipped", "succeeded"],
		)
	})

	it("lets local reads proceed while an external-path approval operation is pending", async () => {
		const approvalGate = deferred<string>()
		const localGate = deferred<string>()
		const bothStarted = deferred<void>()
		const started: number[] = []
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_READ, { path: "/external/file.txt" }),
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/local.ts" }),
			],
			"/workspace",
			{ workspaceLocalBySequence: [false, true] },
		)
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 2,
			run: async (node) => {
				started.push(node.sequence)
				if (started.length === 2) bothStarted.resolve()
				return node.sequence === 0 ? approvalGate.promise : localGate.promise
			},
		})

		const execution = scheduler.execute(nodes)
		await bothStarted.promise
		assert.deepEqual(started, [0, 1])
		localGate.resolve("local")
		await flushMicrotasks()
		approvalGate.resolve("approved")
		await execution
	})

	it("admits reads without spending a concurrency slot on a checkpoint-blocked mutation", async () => {
		const readGate = deferred<string>()
		const mutationGate = deferred<string>()
		const entered: number[] = []
		let checkpointReady = false
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_NEW, { path: "src/new.ts", content: "export {}" }),
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/existing.ts" }),
			],
			"/workspace",
		)
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 1,
			canStart: (node) => !node.requiresCheckpoint || checkpointReady,
			run: async (node) => {
				entered.push(node.sequence)
				return node.sequence === 0 ? mutationGate.promise : readGate.promise
			},
		})

		const execution = scheduler.execute(nodes)
		await flushMicrotasks()
		assert.deepEqual(entered, [1])
		readGate.resolve("read")
		await flushMicrotasks()
		assert.deepEqual(entered, [1])
		checkpointReady = true
		scheduler.signalReady()
		await flushMicrotasks()
		assert.deepEqual(entered, [1, 0])
		mutationGate.resolve("write")
		await execution
	})

	it("bounds active children and joins every child before resolving", async () => {
		const gates = readNodes(7).map(() => deferred<string>())
		let active = 0
		let maxActive = 0
		let completed = 0
		const started: number[] = []
		const scheduler = new SiblingToolScheduler<string>({
			concurrency: 3,
			run: async (node) => {
				active++
				maxActive = Math.max(maxActive, active)
				started.push(node.sequence)
				try {
					return await gates[node.sequence].promise
				} finally {
					active--
					completed++
				}
			},
		})

		const execution = scheduler.execute(readNodes(7))
		await flushMicrotasks()
		assert.deepEqual(started, [0, 1, 2])

		for (let sequence = 0; sequence < gates.length; sequence++) {
			gates[sequence].resolve(`result-${sequence}`)
			await flushMicrotasks()
			assert.ok(active <= 3)
		}
		const results = await execution

		assert.equal(maxActive, 3)
		assert.equal(completed, 7)
		assert.equal(active, 0)
		assert.equal(results.length, 7)
	})
})
