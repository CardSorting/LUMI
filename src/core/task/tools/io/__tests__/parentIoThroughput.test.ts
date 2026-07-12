import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { describe, it } from "mocha"
import { DietCodeDefaultTool } from "@/shared/tools"
import {
	buildIoCoalesceKey,
	getIoRequestCoalescer,
	getIoRequestCoalescerGeneration,
	IoRequestCoalescer,
	resetIoRequestCoalescer,
} from "../IoRequestCoalescer"
import { acquireParentIoSlot, resetParentIoBulkheadForTests } from "../ParentIoBulkhead"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

describe("IoRequestCoalescer", () => {
	it("dedupes identical in-flight I/O requests", async () => {
		const coalescer = new IoRequestCoalescer(5_000)
		const execution = deferred<string>()
		let calls = 0
		const execute = async () => {
			calls++
			return execution.promise
		}
		const key = "read|/tmp|src/foo.ts|"
		const aPromise = coalescer.coalesce(key, execute)
		const bPromise = coalescer.coalesce(key, execute)
		assert.equal(calls, 1)
		assert.deepEqual(coalescer.getStats(), {
			inFlight: 1,
			cached: 0,
			generation: 0,
			cacheHits: 0,
			coalescedWaiters: 1,
			executions: 1,
		})
		execution.resolve("content")
		const [a, b] = await Promise.all([aPromise, bPromise])
		assert.equal(a, "content")
		assert.equal(b, "content")
		assert.equal(calls, 1)
	})

	it("builds stable coalesce keys for file reads", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.FILE_READ,
			params: { path: "src/foo.ts" },
			partial: false,
		}
		const key = buildIoCoalesceKey(block, "/workspace")
		assert.ok(key?.includes("src/foo.ts"))
	})

	it("includes file_pattern in repository-search identity", () => {
		const base: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.SEARCH,
			params: { path: "src", regex: "needle", file_pattern: "*.ts" },
			partial: false,
		}
		const tsKey = buildIoCoalesceKey(base, "/workspace")
		const testKey = buildIoCoalesceKey({ ...base, params: { ...base.params, file_pattern: "*.test.ts" } }, "/workspace")

		assert.notEqual(tsKey, testKey)
		assert.ok(tsKey?.includes("*.ts"))
		assert.ok(testKey?.includes("*.test.ts"))
	})

	it("starts a fresh cache generation after a local mutation", async () => {
		const taskId = "mutation-cache-invalidation"
		let calls = 0
		const execute = async () => ++calls
		const first = getIoRequestCoalescer(taskId)

		assert.equal(await first.coalesce("read|workspace|file", execute), 1)
		assert.equal(await first.coalesce("read|workspace|file", execute), 1)
		resetIoRequestCoalescer(taskId)

		const next = getIoRequestCoalescer(taskId)
		assert.notEqual(next, first)
		assert.equal(await next.coalesce("read|workspace|file", execute), 2)
		resetIoRequestCoalescer(taskId)
	})

	it("does not promote an old in-flight completion into the current generation", async () => {
		const taskId = "in-flight-generation-race"
		resetIoRequestCoalescer(taskId)
		const oldGeneration = getIoRequestCoalescerGeneration(taskId)
		const oldCoalescer = getIoRequestCoalescer(taskId)
		const oldExecution = deferred<string>()
		const oldResult = oldCoalescer.coalesce("read|workspace|file", () => oldExecution.promise)

		resetIoRequestCoalescer(taskId)
		const currentGeneration = getIoRequestCoalescerGeneration(taskId)
		const currentCoalescer = getIoRequestCoalescer(taskId)
		assert.equal(currentGeneration, oldGeneration + 1)
		assert.notEqual(currentCoalescer, oldCoalescer)

		oldExecution.resolve("stale-content")
		assert.equal(await oldResult, "stale-content")

		let freshExecutions = 0
		const readFresh = async () => {
			freshExecutions++
			return "fresh-content"
		}
		assert.equal(await currentCoalescer.coalesce("read|workspace|file", readFresh), "fresh-content")
		assert.equal(await currentCoalescer.coalesce("read|workspace|file", readFresh), "fresh-content")
		assert.equal(freshExecutions, 1)
		assert.deepEqual(currentCoalescer.getStats(), {
			inFlight: 0,
			cached: 1,
			generation: currentGeneration,
			cacheHits: 1,
			coalescedWaiters: 0,
			executions: 1,
		})

		resetIoRequestCoalescer(taskId)
	})
})

describe("ParentIoBulkhead", () => {
	it("allows parallel parent I/O slot acquisition", async () => {
		resetParentIoBulkheadForTests()
		const releaseA = await acquireParentIoSlot(true, true)
		const releaseB = await acquireParentIoSlot(true, true)
		releaseA()
		releaseB()
	})
})
