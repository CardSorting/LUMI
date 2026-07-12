import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { getToolInvocationContext, resolveInvocationResultTarget, runWithToolInvocationContext } from "../ToolInvocationContext"

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe("ToolInvocationContext", () => {
	it("isolates concurrent sibling evidence without completion-order writes to shared state", async () => {
		const fallback: any[] = []
		const release = deferred()
		const contexts = [0, 1].map((sequence) => ({
			invocationId: `call-${sequence}`,
			sequence,
			capturePresentation: true,
			resultContent: [] as any[],
			presentationEvents: [] as any[],
		}))

		const second = runWithToolInvocationContext(contexts[1], async () => {
			await release.promise
			resolveInvocationResultTarget(fallback).push({ type: "text", text: "second" })
			assert.equal(getToolInvocationContext()?.invocationId, "call-1")
		})
		const first = runWithToolInvocationContext(contexts[0], async () => {
			resolveInvocationResultTarget(fallback).push({ type: "text", text: "first" })
			release.resolve()
		})

		await Promise.all([second, first])
		assert.deepEqual(fallback, [])
		assert.deepEqual(contexts[0].resultContent, [{ type: "text", text: "first" }])
		assert.deepEqual(contexts[1].resultContent, [{ type: "text", text: "second" }])
		assert.equal(getToolInvocationContext(), undefined)
	})
})
