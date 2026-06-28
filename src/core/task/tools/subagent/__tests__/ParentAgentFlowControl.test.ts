import { strict as assert } from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import { describe, it } from "mocha"
import {
	AuthorityAwareExecutionPool,
	addSubagentRunStats,
	CoalescingAsyncEmitter,
	calculateRetryDelayMs,
	computeMaxInFlightLanes,
	createParentAbortWatcher,
	createSwarmSchedulerWake,
	emptySubagentRunStats,
	FairSemaphore,
	isRetryableSubagentFailure,
	PriorityFairSemaphore,
	SUBAGENT_STATUS_MIN_INTERVAL_MS,
	shouldPersistSwarmProgressArtifact,
	shouldReleaseLaneClaimBetweenAttempts,
	waitForSettlement,
} from "../ParentAgentFlowControl"

describe("ParentAgentFlowControl", () => {
	it("retries transient infrastructure failures but not deterministic task failures", () => {
		assert.equal(isRetryableSubagentFailure("HTTP 429 rate limit exceeded"), true)
		assert.equal(isRetryableSubagentFailure(new Error("ETIMEDOUT while opening stream")), true)
		assert.equal(isRetryableSubagentFailure("Iteration Limit Exceeded"), false)
		assert.equal(isRetryableSubagentFailure("assertion failed in generated code"), false)
	})

	it("uses capped full-jitter retry delays", () => {
		assert.equal(
			calculateRetryDelayMs(1, () => 0.5),
			250,
		)
		assert.equal(
			calculateRetryDelayMs(3, () => 0.5),
			1_000,
		)
		assert.equal(
			calculateRetryDelayMs(20, () => 1),
			5_000,
		)
	})

	it("accumulates billable retry usage and preserves peak context pressure", () => {
		const first = {
			...emptySubagentRunStats(),
			inputTokens: 10,
			totalCost: 0.1,
			contextTokens: 100,
			contextUsagePercentage: 10,
		}
		const second = {
			...emptySubagentRunStats(),
			inputTokens: 20,
			totalCost: 0.2,
			contextTokens: 80,
			contextUsagePercentage: 8,
		}

		const total = addSubagentRunStats(first, second)
		assert.equal(total.inputTokens, 30)
		assert.equal(total.totalCost, 0.30000000000000004)
		assert.equal(total.contextTokens, 100)
		assert.equal(total.contextUsagePercentage, 10)
	})

	it("coalesces bursty progress and seals the terminal state", async () => {
		const emitted: number[] = []
		const emitter = new CoalescingAsyncEmitter<number>(async (value) => {
			emitted.push(value)
		}, 60_000)

		emitter.enqueue(1)
		emitter.enqueue(2)
		emitter.enqueue(3)
		await emitter.close(4)
		emitter.enqueue(5)

		assert.deepEqual(emitted, [4])
	})

	it("stops progress I/O without flushing a stale queued snapshot", async () => {
		const emitted: number[] = []
		const emitter = new CoalescingAsyncEmitter<number>(async (value) => {
			emitted.push(value)
		}, 60_000)

		await emitter.flush(1)
		emitter.enqueue(2)
		await emitter.stop()
		emitter.enqueue(3)

		assert.deepEqual(emitted, [1])
	})

	it("hands released capacity to queued work in FIFO order", async () => {
		const semaphore = new FairSemaphore(2)
		const releaseFirst = await semaphore.acquire()
		const releaseSecond = await semaphore.acquire()
		const order: number[] = []
		const third = semaphore.acquire().then((release) => {
			order.push(3)
			return release
		})
		const fourth = semaphore.acquire().then((release) => {
			order.push(4)
			return release
		})

		assert.equal(semaphore.getActiveCount(), 2)
		assert.equal(semaphore.getPendingCount(), 2)
		releaseFirst()
		const releaseThird = await third
		assert.deepEqual(order, [3])
		releaseSecond()
		const releaseFourth = await fourth
		assert.deepEqual(order, [3, 4])
		releaseThird()
		releaseFourth()
		assert.equal(semaphore.getActiveCount(), 0)
	})

	it("resolves waitForSettlement when the underlying promise settles", async () => {
		const settled = await waitForSettlement(Promise.resolve("done"), 100)
		assert.equal(settled, true)
	})

	it("times out waitForSettlement when the underlying promise keeps running", async () => {
		const settled = await waitForSettlement(new Promise(() => undefined), 25)
		assert.equal(settled, false)
	})

	it("serves higher-priority waiters before lower-priority waiters", async () => {
		const semaphore = new PriorityFairSemaphore(1)
		const releaseFirst = await semaphore.acquire()
		const order: number[] = []
		const low = semaphore.acquire(1).then((release) => {
			order.push(1)
			return release
		})
		const high = semaphore.acquire(10).then((release) => {
			order.push(10)
			return release
		})

		releaseFirst()
		const releaseHigh = await high
		assert.deepEqual(order, [10])
		releaseHigh()
		const releaseLow = await low
		assert.deepEqual(order, [10, 1])
		releaseLow()
	})

	it("preserves FIFO order among equal-priority waiters", async () => {
		const semaphore = new PriorityFairSemaphore(1)
		const releaseFirst = await semaphore.acquire()
		const order: number[] = []
		const second = semaphore.acquire(5).then((release) => {
			order.push(2)
			return release
		})
		const third = semaphore.acquire(5).then((release) => {
			order.push(3)
			return release
		})

		releaseFirst()
		const releaseSecond = await second
		assert.deepEqual(order, [2])
		releaseSecond()
		const releaseThird = await third
		assert.deepEqual(order, [2, 3])
		releaseThird()
	})

	it("fires createParentAbortWatcher immediately when already aborted", () => {
		let fired = false
		const stop = createParentAbortWatcher(
			() => true,
			() => {
				fired = true
			},
		)
		assert.equal(fired, true)
		stop()
	})

	it("coalesces bursty progress to one write per minimum interval", async () => {
		const emitted: number[] = []
		const emitter = new CoalescingAsyncEmitter<number>(async (value) => {
			emitted.push(value)
		}, SUBAGENT_STATUS_MIN_INTERVAL_MS)

		emitter.enqueue(1)
		emitter.enqueue(2)
		await delay(SUBAGENT_STATUS_MIN_INTERVAL_MS + 40)
		emitter.enqueue(3)
		await emitter.close(4)

		assert.deepEqual(emitted, [2, 4])
	})

	it("reserves capacity for fast I/O lanes when mutation lanes saturate the pool", async () => {
		const pool = new AuthorityAwareExecutionPool(3, 1)
		const order: string[] = []
		const releaseMut1 = await pool.acquire(1, false)
		const releaseMut2 = await pool.acquire(1, false)
		const releaseMut3 = await pool.acquire(1, false)
		assert.equal(pool.getActiveCount(), 3)

		const fastPromise = pool.acquire(10, true).then((release) => {
			order.push("fast")
			return release
		})
		const mutPromise = pool.acquire(5, false).then((release) => {
			order.push("mut")
			return release
		})

		releaseMut1()
		const releaseFast = await fastPromise
		assert.deepEqual(order, ["fast"])

		releaseMut2()
		releaseMut3()
		const releaseMut = await mutPromise
		assert.deepEqual(order, ["fast", "mut"])
		releaseFast()
		releaseMut()
		assert.equal(pool.getActiveCount(), 0)
	})

	it("computes bounded in-flight lane capacity from pool size", () => {
		assert.equal(computeMaxInFlightLanes(3), 4)
	})

	it("releases governed locks between parent-layer retries", () => {
		assert.equal(shouldReleaseLaneClaimBetweenAttempts(true, true), true)
		assert.equal(shouldReleaseLaneClaimBetweenAttempts(false, true), false)
		assert.equal(shouldReleaseLaneClaimBetweenAttempts(true, false), false)
	})

	it("skips durable artifact writes for partial running progress", () => {
		assert.equal(shouldPersistSwarmProgressArtifact("running", true), false)
		assert.equal(shouldPersistSwarmProgressArtifact("running", false), true)
		assert.equal(shouldPersistSwarmProgressArtifact("completed", true), true)
	})

	it("wakes the lane scheduler when a slot is released", async () => {
		const wake = createSwarmSchedulerWake()
		let notified = false
		const waiting = wake.wait().then(() => {
			notified = true
		})
		wake.notify()
		await waiting
		assert.equal(notified, true)
	})
})
