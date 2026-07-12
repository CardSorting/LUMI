import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import { Task } from ".."
import { TaskLatencyTracker } from "../latency/TaskLatencyTracker"
import { TaskState } from "../TaskState"

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function read(path: string): ToolUse {
	return { type: "tool_use", name: DietCodeDefaultTool.FILE_READ, params: { path }, partial: false }
}

function bareTask(executeToolCaptured: (...args: any[]) => Promise<any>) {
	const task = Object.create(Task.prototype) as any
	task.taskId = "batch-test"
	task.cwd = "/workspace"
	task.taskState = new TaskState()
	task.latencyTracker = new TaskLatencyTracker()
	task.siblingBatchSequence = 0
	task.resolveSiblingWorkspaceLocality = async (blocks: ToolUse[]) => blocks.map(() => true)
	const visible: string[] = []
	task.say = async (_type: string, text?: string) => {
		visible.push(text ?? "")
		return 1
	}
	task.removeLastPartialMessageIfExistsWithType = async () => undefined
	task.toolExecutor = {
		executeToolCaptured,
		captureSyntheticToolResult: async (_block: ToolUse, _sequence: number, _id: string, content: string) => [
			{ type: "text", text: content },
		],
	}
	return { task, visible }
}

describe("Task sibling tool batch", () => {
	it("executes independent reads together and projects UI/results in model-emission order", async () => {
		const gates = Array.from({ length: 4 }, () => deferred())
		const started: number[] = []
		const { task, visible } = bareTask(async (_block, sequence) => {
			started.push(sequence)
			await gates[sequence].promise
			return {
				resultContent: [{ type: "text", text: `result-${sequence}` }],
				presentationEvents: [{ type: "say", args: ["tool", `card-${sequence}`] }],
			}
		})

		const execution = task.executeSiblingToolBatch([read("a.ts"), read("b.ts"), read("c.ts"), read("d.ts")])
		while (started.length < 4) await Promise.resolve()
		assert.deepEqual(started, [0, 1, 2, 3])
		for (const sequence of [3, 2, 1, 0]) gates[sequence].resolve()
		await execution

		assert.deepEqual(
			task.taskState.userMessageContent.map((content: { text?: string }) => content.text),
			["result-0", "result-1", "result-2", "result-3"],
		)
		assert.deepEqual(visible.slice(1), ["card-0", "card-1", "card-2", "card-3"])
		assert.equal(task.latencyTracker.snapshot().maxConcurrentSiblings, 4)
		assert.equal(task.activeSiblingScheduler, undefined)
		assert.equal(task.activeSiblingBatchPromise, undefined)
	})

	it("lets a read start while only the mutation waits for initial checkpoint readiness", async () => {
		const checkpoint = deferred<string | undefined>()
		const started: string[] = []
		const { task } = bareTask(async (block: ToolUse) => {
			started.push(block.name)
			return { resultContent: [{ type: "text", text: block.name }], presentationEvents: [] }
		})
		task.initialCheckpointCommitPromise = checkpoint.promise
		const write: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.FILE_NEW,
			params: { path: "out.ts", content: "export {}" },
			partial: false,
		}

		const execution = task.executeSiblingToolBatch([read("input.ts"), write])
		while (!started.includes(DietCodeDefaultTool.FILE_READ)) await Promise.resolve()
		assert.deepEqual(started, [DietCodeDefaultTool.FILE_READ])
		checkpoint.resolve("checkpoint")
		await execution
		assert.deepEqual(started, [DietCodeDefaultTool.FILE_READ, DietCodeDefaultTool.FILE_NEW])
	})

	it("keeps successful independent results when one sibling throws", async () => {
		const { task } = bareTask(async (_block, sequence) => {
			if (sequence === 1) throw new Error("read failed")
			return { resultContent: [{ type: "text", text: `ok-${sequence}` }], presentationEvents: [] }
		})

		await task.executeSiblingToolBatch([read("a.ts"), read("b.ts"), read("c.ts")])
		const results = task.taskState.userMessageContent.map((content: { text?: string }) => content.text ?? "")
		assert.equal(results[0], "ok-0")
		assert.match(results[1], /read failed/)
		assert.equal(results[2], "ok-2")
	})

	it("continues when task-local instrumentation is unavailable", async () => {
		const { task } = bareTask(async (_block, sequence) => ({
			resultContent: [{ type: "text", text: `ok-${sequence}` }],
			presentationEvents: [],
		}))
		task.latencyTracker = new TaskLatencyTracker(() => {
			throw new Error("clock unavailable")
		})

		await task.executeSiblingToolBatch([read("a.ts"), read("b.ts")])
		assert.deepEqual(
			task.taskState.userMessageContent.map((content: { text?: string }) => content.text),
			["ok-0", "ok-1"],
		)
	})

	it("keeps execution evidence when a per-tool presentation update fails", async () => {
		const { task } = bareTask(async () => ({
			resultContent: [{ type: "text", text: "durable result" }],
			presentationEvents: [{ type: "say", args: ["tool", "broken card"] }],
		}))
		let calls = 0
		task.say = async () => {
			calls++
			if (calls > 1) throw new Error("webview unavailable")
			return 1
		}

		await task.executeSiblingToolBatch([read("a.ts"), read("b.ts")])
		assert.deepEqual(
			task.taskState.userMessageContent.map((content: { text?: string }) => content.text),
			["durable result", "durable result"],
		)
	})
})
