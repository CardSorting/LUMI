/**
 * [LAYER: CORE]
 * Degraded mode contract — no active reuse, visible in diagnostics.
 */

import { assert } from "chai"
import {
	getJoyRideDegradedReason,
	isJoyRideDegraded,
	markJoyRideDegraded,
	resetJoyRideDegraded,
	setJoyRideConfig,
} from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideBugReportSnapshot, summarizeJoyRideHealth } from "../JoyRideDiagnostics"
import { lookupSafeCommandResult, lookupSearchResult, storeReusableCommandResult, storeSearchResult } from "../JoyRideHotPath"
import { assertDecisionInvariants, createJoyRideTestCache, createTaskScope } from "./JoyRideTestHelpers"

describe("JoyRide degraded mode contract", () => {
	beforeEach(() => {
		resetJoyRideDegraded()
		setJoyRideConfig({ mode: "enabled" })
	})

	afterEach(() => {
		resetJoyRideDegraded()
	})

	it("should suspend command reuse when degraded", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "enabled" })
		markJoyRideDegraded("test failure")
		assert.isTrue(isJoyRideDegraded())
		const scope = createTaskScope("degraded-cmd")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
		assert.isTrue(decision.degraded)
	})

	it("should suspend search reuse when degraded", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "enabled" })
		markJoyRideDegraded("search subsystem")
		const scope = createTaskScope("degraded-search")
		cache.registerTask(scope.taskId, scope.generation)
		const opts = { cwd: process.cwd() }
		await storeSearchResult(cache, "q", opts, "r", 1, scope)
		const decision = await lookupSearchResult(cache, "q", opts, scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("should appear in health summary and bug report snapshot", async () => {
		const cache = createJoyRideTestCache()
		markJoyRideDegraded("snapshot test")
		const health = summarizeJoyRideHealth(cache)
		assert.include(health, "degraded=true")
		const snapshot = JSON.parse(createJoyRideBugReportSnapshot(cache))
		assert.isTrue(snapshot.degraded)
		assert.equal(snapshot.degradedReason, getJoyRideDegradedReason())
	})
})
