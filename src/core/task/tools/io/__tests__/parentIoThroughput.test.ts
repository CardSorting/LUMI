import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { describe, it } from "mocha"
import { DietCodeDefaultTool } from "@/shared/tools"
import { buildIoCoalesceKey, IoRequestCoalescer } from "../IoRequestCoalescer"
import { acquireParentIoSlot, resetParentIoBulkheadForTests } from "../ParentIoBulkhead"

describe("IoRequestCoalescer", () => {
	it("dedupes identical in-flight I/O requests", async () => {
		const coalescer = new IoRequestCoalescer(5_000)
		let calls = 0
		const execute = async () => {
			calls++
			await new Promise((r) => setTimeout(r, 20))
			return "content"
		}
		const key = "read|/tmp|src/foo.ts|"
		const [a, b] = await Promise.all([coalescer.coalesce(key, execute), coalescer.coalesce(key, execute)])
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
