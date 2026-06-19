/**
 * [LAYER: CORE]
 * Typed decision invariant contract tests.
 */

import { assert } from "chai"
import { setJoyRideConfig } from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { lookupSafeCommandResult, lookupSearchResult, storeReusableCommandResult, storeSearchResult } from "../JoyRideHotPath"
import { JOYRIDE_REASON } from "../JoyRideReasonCodes"
import { assertDecisionInvariants, createJoyRideTestCache, createTaskScope, expectCacheHit } from "./JoyRideTestHelpers"

describe("JoyRide decision invariants", () => {
	it("should include required fields on command miss", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope()
		cache.registerTask(scope.taskId, scope.generation)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.equal(decision.fallbackBehavior, "executeNormally")
	})

	it("should include value and reuseCachedValue on command hit", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope()
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/cached\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		expectCacheHit(decision)
		assert.equal(decision.fallbackBehavior, "reuseCachedValue")
		assert.isTrue(isJoyRideHitDecision(decision))
	})

	it("should never let disabled decisions satisfy isJoyRideHitDecision", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "disabled" })
		const scope = createTaskScope()
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.equal(decision.type, "disabled")
		assert.isFalse(isJoyRideHitDecision(decision))
		assert.equal(decision.fallbackBehavior, "doNotStore")
	})

	it("should never let diagnostic-only decisions satisfy isJoyRideHitDecision", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope()
		cache.registerTask(scope.taskId, scope.generation)
		const decision = await lookupSafeCommandResult(cache, "npm install lodash", scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("should include fallback on search miss and hit", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope()
		cache.registerTask(scope.taskId, scope.generation)
		const opts = { cwd: process.cwd() }
		const miss = await lookupSearchResult(cache, "pattern", opts, scope)
		assertDecisionInvariants(miss)
		await storeSearchResult(cache, "pattern", opts, "results", 1, scope)
		const hit = await lookupSearchResult(cache, "pattern", opts, scope)
		assertDecisionInvariants(hit)
		assert.equal(hit.fallbackBehavior, "reuseCachedValue")
	})

	it("should refuse verification reuse without file hashes", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope()
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "ok\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope, 0, {})
		assertDecisionInvariants(decision)
		assert.equal(decision.reasonCode, JOYRIDE_REASON.MISS_VERIFICATION_MISSING_FILE_HASHES)
		assert.equal(decision.fallbackBehavior, "executeNormally")
	})
})
