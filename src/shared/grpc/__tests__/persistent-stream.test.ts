import { expect } from "chai"
import { describe, it } from "mocha"
import {
	computeBackoffDelay,
	DEFAULT_RECONNECT_POLICY,
	isDegradedState,
	isHealthyState,
	isPersistentStreamingMethod,
	isTerminalFailedState,
	shouldApplyStreamIdleTimeout,
	shouldRecoverFromFailedOnAcquire,
} from "../persistent-stream"

describe("persistent-stream contract", () => {
	it("detects persistent RPC methods", () => {
		expect(isPersistentStreamingMethod("subscribeToState")).to.be.true
		expect(isPersistentStreamingMethod("triggerAudit")).to.be.false
	})

	it("applies idle timeout only to finite streams", () => {
		expect(shouldApplyStreamIdleTimeout("subscribeToPartialMessage")).to.be.false
		expect(shouldApplyStreamIdleTimeout("triggerAudit")).to.be.true
	})

	it("computes bounded exponential backoff", () => {
		const first = computeBackoffDelay(0, { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0 })
		const second = computeBackoffDelay(1, { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0 })
		expect(first).to.equal(250)
		expect(second).to.equal(500)
	})

	it("caps backoff at maxDelayMs", () => {
		const delay = computeBackoffDelay(100, { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0 })
		expect(delay).to.equal(DEFAULT_RECONNECT_POLICY.maxDelayMs)
	})

	it("classifies health states", () => {
		expect(isHealthyState("connected")).to.be.true
		expect(isDegradedState("reconnecting")).to.be.true
		expect(isDegradedState("stale")).to.be.true
		expect(isTerminalFailedState("failed")).to.be.true
		expect(shouldRecoverFromFailedOnAcquire("failed")).to.be.true
		expect(shouldRecoverFromFailedOnAcquire("connected")).to.be.false
	})
})
