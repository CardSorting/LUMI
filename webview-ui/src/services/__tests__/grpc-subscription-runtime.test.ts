import {
	DEFAULT_RECONNECT_POLICY,
	DEFAULT_STREAM_IDLE_TIMEOUT_MS,
	DEFAULT_UNARY_TIMEOUT_MS,
	shouldApplyStreamIdleTimeout,
} from "@shared/grpc/persistent-stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Callbacks } from "@/services/grpc-client-base"
import { GrpcSubscriptionRuntime } from "@/services/grpc-subscription-runtime"

describe("GrpcSubscriptionRuntime closeout invariants", () => {
	let runtime: GrpcSubscriptionRuntime

	beforeEach(() => {
		vi.useFakeTimers()
		runtime = new GrpcSubscriptionRuntime()
	})

	afterEach(() => {
		runtime.resetForTests()
		vi.useRealTimers()
	})

	const createSubscribeMock = (behavior: "complete-on-first" | "error-always" | "message" | "slow-connect") => {
		let connectCount = 0
		const cancel = vi.fn()
		const subscribe = vi.fn((_request: Record<string, unknown>, callbacks: Callbacks<{ ok: boolean }>) => {
			connectCount += 1
			if (behavior === "complete-on-first" && connectCount === 1) {
				queueMicrotask(() => callbacks.onComplete?.())
			} else if (behavior === "error-always") {
				queueMicrotask(() => callbacks.onError?.(new Error("disconnect")))
			} else if (behavior === "message") {
				queueMicrotask(() => callbacks.onResponse?.({ ok: true }))
			} else if (behavior === "slow-connect") {
				// leave connecting until cancel
			}
			return cancel
		})
		return { subscribe, cancel, getConnectCount: () => connectCount }
	}

	it("shares one transport per stable key (ref-counted)", async () => {
		const { subscribe } = createSubscribeMock("message")
		const releaseA = runtime.acquire({ key: "shared", subscribe, request: {}, staleAfterMs: null }, { onMessage: vi.fn() })
		const releaseB = runtime.acquire({ key: "shared", subscribe, request: {}, staleAfterMs: null }, { onMessage: vi.fn() })

		await Promise.resolve()
		expect(subscribe).toHaveBeenCalledTimes(1)
		expect(runtime.getSnapshot("shared")?.refCount).toBe(2)

		releaseA()
		expect(runtime.getSnapshot("shared")?.refCount).toBe(1)
		releaseB()
		expect(runtime.getSnapshot("shared")).toBeUndefined()
	})

	it("uses distinct transports for distinct keys", async () => {
		const subA = createSubscribeMock("message")
		const subB = createSubscribeMock("message")

		runtime.acquire({ key: "a", subscribe: subA.subscribe, request: {}, staleAfterMs: null }, { onMessage: vi.fn() })
		runtime.acquire({ key: "b", subscribe: subB.subscribe, request: {}, staleAfterMs: null }, { onMessage: vi.fn() })

		await Promise.resolve()
		expect(subA.subscribe).toHaveBeenCalledTimes(1)
		expect(subB.subscribe).toHaveBeenCalledTimes(1)
	})

	it("does not reconnect after dispose during reconnect delay", async () => {
		const { subscribe } = createSubscribeMock("complete-on-first")
		const release = runtime.acquire(
			{ key: "dispose-delay", subscribe, request: {}, staleAfterMs: null },
			{ onMessage: vi.fn() },
		)

		await Promise.resolve()
		expect(subscribe).toHaveBeenCalledTimes(1)

		release()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(subscribe).toHaveBeenCalledTimes(1)
	})

	it("unsubscribe during active connect is idempotent and does not reconnect", async () => {
		const { subscribe, cancel } = createSubscribeMock("slow-connect")
		const release = runtime.acquire(
			{ key: "unsub-connect", subscribe, request: {}, staleAfterMs: null },
			{ onMessage: vi.fn() },
		)

		expect(subscribe).toHaveBeenCalledTimes(1)
		release()
		expect(cancel).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(60_000)
		expect(subscribe).toHaveBeenCalledTimes(1)
	})

	it("survives handler throws without tearing down transport", async () => {
		const { subscribe } = createSubscribeMock("message")
		const onMessage = vi.fn(() => {
			throw new Error("handler blew up")
		})

		runtime.acquire({ key: "handler-throw", subscribe, request: {}, staleAfterMs: null }, { onMessage })

		await Promise.resolve()
		expect(onMessage).toHaveBeenCalled()
		expect(runtime.getSnapshot("handler-throw")?.hasActiveTransport).toBe(true)
	})

	it("visibility restore does not duplicate healthy connected streams", async () => {
		const { subscribe } = createSubscribeMock("message")
		runtime.acquire({ key: "healthy", subscribe, request: {}, staleAfterMs: null }, { onMessage: vi.fn() })

		await Promise.resolve()
		expect(subscribe).toHaveBeenCalledTimes(1)

		runtime.reconnectStale("visibility_restore")
		await Promise.resolve()
		expect(subscribe).toHaveBeenCalledTimes(1)
	})

	it("failed state recovers when a new consumer subscribes", async () => {
		const { subscribe } = createSubscribeMock("error-always")

		const release = runtime.acquire(
			{
				key: "failed-recover",
				subscribe,
				request: {},
				reconnect: { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0, maxAttempts: 1 },
				staleAfterMs: null,
			},
			{ onMessage: vi.fn() },
		)

		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(runtime.getHealthState("failed-recover")).toBe("failed")

		release()
		runtime.acquire(
			{
				key: "failed-recover",
				subscribe,
				request: {},
				reconnect: { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0, maxAttempts: 1 },
				staleAfterMs: null,
			},
			{ onMessage: vi.fn() },
		)

		await Promise.resolve()
		expect(subscribe.mock.calls.length).toBeGreaterThan(1)
		expect(runtime.getHealthState("failed-recover")).not.toBe("failed")
	})

	it("stale watchdog does not revive disposed subscriptions", async () => {
		const { subscribe } = createSubscribeMock("message")
		const release = runtime.acquire(
			{ key: "stale-dispose", subscribe, request: {}, staleAfterMs: 500 },
			{ onMessage: vi.fn() },
		)

		await Promise.resolve()
		release()
		await vi.advanceTimersByTimeAsync(500)
		expect(subscribe).toHaveBeenCalledTimes(1)
	})

	it("bounded retry stops after final unsubscribe", async () => {
		const { subscribe } = createSubscribeMock("error-always")
		const release = runtime.acquire(
			{
				key: "bounded-stop",
				subscribe,
				request: {},
				reconnect: { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0, maxAttempts: 10 },
				staleAfterMs: null,
			},
			{ onMessage: vi.fn() },
		)

		await Promise.resolve()
		release()
		await vi.advanceTimersByTimeAsync(120_000)
		expect(subscribe).toHaveBeenCalledTimes(1)
	})

	it("does not create duplicate streams after reconnect", async () => {
		const { subscribe } = createSubscribeMock("complete-on-first")
		const release = runtime.acquire({ key: "reconnect", subscribe, request: {}, staleAfterMs: null }, { onMessage: vi.fn() })

		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(DEFAULT_RECONNECT_POLICY.initialDelayMs + 1000)
		expect(subscribe).toHaveBeenCalledTimes(2)

		release()
	})
})

describe("persistent-stream contract (client/server symmetry)", () => {
	it("skips idle timeout for subscribeTo methods", () => {
		expect(shouldApplyStreamIdleTimeout("subscribeToState")).toBe(false)
		expect(shouldApplyStreamIdleTimeout("triggerAudit")).toBe(true)
	})

	it("uses shared timeout constants", () => {
		expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBeGreaterThan(0)
		expect(DEFAULT_UNARY_TIMEOUT_MS).toBeGreaterThan(0)
	})
})
