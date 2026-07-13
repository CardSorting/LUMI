import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { TaskLatencyTracker } from "@core/task/latency/TaskLatencyTracker"
import { afterEach, describe, it } from "mocha"
import { DietCodeDefaultTool } from "@/shared/tools"
import { runWithToolInvocationContext } from "../../siblings/ToolInvocationContext"
import type { TaskConfig } from "../../types/TaskConfig"
import { disposeIoRequestCoalescer, getIoRequestCoalescerTaskCountForTests } from "../IoRequestCoalescer"
import { acquireParentIoSlot, getParentIoBulkheadStats, resetParentIoBulkheadForTests } from "../ParentIoBulkhead"
import { executeTaskIoBackend } from "../TaskIoBackend"
import type { PathAuthorityRecord } from "../TaskPathAuthorityCache"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function block(path = "src/a.ts"): ToolUse {
	return {
		type: "tool_use",
		name: DietCodeDefaultTool.FILE_READ,
		params: { path },
		partial: false,
	}
}

function authority(overrides: Partial<PathAuthorityRecord> = {}): PathAuthorityRecord {
	return {
		originalInput: "src/a.ts",
		inputSource: "path",
		workspaceHintMatched: true,
		normalizedInput: "src/a.ts",
		displayPath: "src/a.ts",
		normalizedWorkspaceRelativePath: "src/a.ts",
		canonicalWorkspaceRelativePath: "src/a.ts",
		absolutePath: "/workspace/src/a.ts",
		canonicalTarget: "/workspace/src/a.ts",
		nearestExistingAncestor: "/workspace/src/a.ts",
		targetExists: true,
		selectedWorkspaceRoot: { path: "/workspace", name: "workspace" },
		canonicalSelectedWorkspaceRoot: "/workspace",
		containingWorkspaceRoot: { path: "/workspace", name: "workspace" },
		canonicalWorkspaceRoots: [{ path: "/workspace", name: "workspace" }],
		workspaceIdentity: "workspace-v1",
		lexicallyContained: true,
		contained: true,
		external: false,
		ignoreApplicable: true,
		ignoreAllowed: true,
		filesystemGeneration: 0,
		policyGeneration: 1,
		workspaceGeneration: 0,
		...overrides,
	}
}

function config(taskId: string, tracker = new TaskLatencyTracker()): TaskConfig {
	return {
		taskId,
		taskState: { swarmRuntime: undefined },
		latencyTracker: tracker,
	} as unknown as TaskConfig
}

function invoke<T>(
	taskConfig: TaskConfig,
	toolBlock: ToolUse,
	authorityRecord: PathAuthorityRecord,
	id: string,
	signal: AbortSignal | undefined,
	execute: Parameters<typeof executeTaskIoBackend<T>>[4],
): Promise<T> {
	return runWithToolInvocationContext(
		{
			invocationId: id,
			sequence: Number(id.split("-").at(-1) ?? 0),
			capturePresentation: true,
			resultContent: [],
			presentationEvents: [],
			signal,
		},
		() => executeTaskIoBackend(taskConfig, toolBlock, authorityRecord, "small-read", execute),
	)
}

describe("TaskIoBackend", () => {
	afterEach(() => resetParentIoBulkheadForTests())

	it("singleflights before bulkhead admission so identical waiters consume one slot", async () => {
		const taskId = "io-backend-singleflight"
		const tracker = new TaskLatencyTracker()
		const taskConfig = config(taskId, tracker)
		const pendingBackend = deferred<string>()
		const backendEntered = deferred<void>()
		let executions = 0
		const execute = async () => {
			executions++
			backendEntered.resolve()
			return pendingBackend.promise
		}

		const first = invoke(taskConfig, block(), authority(), "read-0", undefined, execute)
		const second = invoke(taskConfig, block(), authority(), "read-1", undefined, execute)
		await backendEntered.promise

		assert.equal(executions, 1)
		assert.equal(getParentIoBulkheadStats().active, 1)
		pendingBackend.resolve("immutable-content")
		assert.deepEqual(await Promise.all([first, second]), ["immutable-content", "immutable-content"])
		assert.equal(tracker.snapshot().ioCounters.coalescedWaiters, 1)

		disposeIoRequestCoalescer(taskId)
	})

	it("never reuses external-path results as approval authority", async () => {
		const taskId = "io-backend-external"
		const taskConfig = config(taskId)
		const external = authority({ contained: false, external: true, lexicallyContained: false })
		let executions = 0
		const execute = async () => `result-${++executions}`

		const results = await Promise.all([
			invoke(taskConfig, block("/outside/a.ts"), external, "external-0", undefined, execute),
			invoke(taskConfig, block("/outside/a.ts"), external, "external-1", undefined, execute),
		])

		assert.deepEqual(results, ["result-1", "result-2"])
		assert.equal(executions, 2)
		disposeIoRequestCoalescer(taskId)
	})

	it("leaves no task-owned I/O worker, queue entry, or cache after normal completion", async () => {
		const taskId = "io-backend-completion-cleanup"
		const taskCountBefore = getIoRequestCoalescerTaskCountForTests()

		assert.equal(
			await invoke(config(taskId), block(), authority(), "read-complete", undefined, async () => "complete"),
			"complete",
		)
		assert.equal(getParentIoBulkheadStats().active, 0)
		assert.equal(getParentIoBulkheadStats().pending, 0)

		disposeIoRequestCoalescer(taskId)
		assert.equal(getIoRequestCoalescerTaskCountForTests(), taskCountBefore)
	})

	it("uses the task-owned signal for a non-sibling invocation and joins cancellation", async () => {
		const taskId = "io-backend-single-cancel"
		const controller = new AbortController()
		const taskConfig = config(taskId)
		taskConfig.taskSignal = controller.signal
		const entered = deferred<void>()
		const pending = invoke(taskConfig, block(), authority(), "single-read", undefined, async (_io, signal) => {
			assert.equal(signal, controller.signal)
			entered.resolve()
			return await new Promise<string>((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
			})
		})

		await entered.promise
		controller.abort(new Error("cancel direct read"))
		await assert.rejects(pending, /cancel direct read/)
		assert.equal(getParentIoBulkheadStats().active, 0)
		disposeIoRequestCoalescer(taskId)
	})

	it("removes cancelled queued work and leaves no task coalescer behind", async () => {
		const taskId = "io-backend-cancel"
		const taskCountBefore = getIoRequestCoalescerTaskCountForTests()
		const releaseA = await acquireParentIoSlot(true, false, { workClass: "search" })
		const releaseB = await acquireParentIoSlot(true, false, { workClass: "search" })
		const controller = new AbortController()
		let backendCalled = false
		const pending = runWithToolInvocationContext(
			{
				invocationId: "search-queued",
				sequence: 0,
				capturePresentation: true,
				resultContent: [],
				presentationEvents: [],
				signal: controller.signal,
			},
			() =>
				executeTaskIoBackend(config(taskId), block(), authority(), "search", async () => {
					backendCalled = true
					return "unexpected"
				}),
		)
		await Promise.resolve()
		assert.equal(getParentIoBulkheadStats().byClass.search.pending, 1)

		controller.abort(new Error("stop queued search"))
		await assert.rejects(pending, /stop queued search/)
		await Promise.resolve()
		assert.equal(backendCalled, false)
		assert.equal(getParentIoBulkheadStats().byClass.search.pending, 0)
		releaseA()
		releaseB()
		disposeIoRequestCoalescer(taskId)
		assert.equal(getIoRequestCoalescerTaskCountForTests(), taskCountBefore)
	})
})
