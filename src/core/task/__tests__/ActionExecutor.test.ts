import assert from "node:assert/strict"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { ActionExecutor } from "../ActionExecutor"

describe("ActionExecutor timer ownership", () => {
	afterEach(() => sinon.restore())

	it("clears the timeout timer when an operation finishes first", async () => {
		const clock = sinon.useFakeTimers()
		const action = new ActionExecutor()
		const result = await action.execute("fast", async () => "done", {
			timeoutMs: 60_000,
			maxRetries: 1,
			concurrencyGroup: "timer-fast",
		})

		assert.equal(result, "done")
		assert.equal(clock.countTimers(), 0)
	})

	it("clears the timeout timer after the deadline rejects", async () => {
		const clock = sinon.useFakeTimers()
		const action = new ActionExecutor()
		const pending = action.execute("slow", () => new Promise<never>(() => undefined), {
			timeoutMs: 25,
			maxRetries: 1,
			concurrencyGroup: "timer-slow",
		})

		await clock.tickAsync(25)
		await assert.rejects(pending, /timed out after 25ms/)
		assert.equal(clock.countTimers(), 0)
	})

	it("creates no timer when the backend owns cancellation", async () => {
		const clock = sinon.useFakeTimers()
		const action = new ActionExecutor()
		assert.equal(
			await action.execute("owned", async () => "owned-result", {
				timeoutMs: 0,
				maxRetries: 1,
				concurrencyGroup: "timer-owned",
			}),
			"owned-result",
		)
		assert.equal(clock.countTimers(), 0)
	})
})
