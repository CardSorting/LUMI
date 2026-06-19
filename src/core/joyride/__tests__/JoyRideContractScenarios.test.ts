/**
 * [LAYER: CORE]
 * End-to-end contract scenarios across enabled, disabled, diagnostics-only, degraded modes.
 */

import { assert } from "chai"
import { markJoyRideDegraded, resetJoyRideDegraded, setJoyRideConfig } from "../JoyRideConfig"
import { getJoyRideDecisionLog } from "../JoyRideDecisionLog"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideBugReportSnapshot } from "../JoyRideDiagnostics"
import { lookupSafeCommandResult, lookupSearchResult, storeReusableCommandResult, storeSearchResult } from "../JoyRideHotPath"
import { flushTaskGeneration, shutdownJoyRide } from "../JoyRideLifecycle"
import { JOYRIDE_REASON } from "../JoyRideReasonCodes"
import {
	assertDecisionInvariants,
	createJoyRideTestCache,
	createTaskScope,
	expectCacheHit,
	expectNoActiveReuse,
	expectNoUnsafeReuse,
} from "./JoyRideTestHelpers"

async function runEnabledSession(cache: ReturnType<typeof createJoyRideTestCache>, scope: ReturnType<typeof createTaskScope>) {
	const cmdMiss = await lookupSafeCommandResult(cache, "git status", scope)
	assertDecisionInvariants(cmdMiss)
	await storeReusableCommandResult(cache, "git status", [false, "clean\n"], scope)
	const cmdHit = await lookupSafeCommandResult(cache, "git status", scope)
	assertDecisionInvariants(cmdHit)
	expectCacheHit(cmdHit)

	const searchOpts = { cwd: scope.cwd, includeGlobs: ["*.ts"] as string[] }
	await storeSearchResult(cache, "export", searchOpts, "Found 1", 1, scope)
	const searchHit = await lookupSearchResult(cache, "export", searchOpts, scope)
	assertDecisionInvariants(searchHit)
	expectCacheHit(searchHit)

	const verifyMiss = await lookupSafeCommandResult(cache, "npm test", scope, 0, {})
	expectNoActiveReuse(verifyMiss)

	const unsafe = await lookupSafeCommandResult(cache, "npm install x", scope)
	expectNoActiveReuse(unsafe)
}

describe("JoyRide contract scenarios", () => {
	afterEach(() => {
		resetJoyRideDegraded()
		setJoyRideConfig({ mode: "enabled" })
	})

	it("enabled session: typed decisions, safe reuse only, bounded diagnostics", async () => {
		setJoyRideConfig({ mode: "enabled" })
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("scenario-enabled")
		cache.registerTask(scope.taskId, scope.generation)
		await runEnabledSession(cache, scope)
		expectNoUnsafeReuse(getJoyRideDecisionLog())
		assert.isAtMost(getJoyRideDecisionLog(256).length, 128)
		flushTaskGeneration(cache, scope.taskId, "task_completed")
		shutdownJoyRide(cache)
	})

	it("disabled session: no hits, doNotStore fallback", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "disabled" })
		const scope = createTaskScope("scenario-disabled")
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.equal(decision.type, "disabled")
		assert.equal(decision.fallbackBehavior, "doNotStore")
	})

	it("diagnostics-only session: stores allowed, no active reuse", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "diagnostics-only" })
		const scope = createTaskScope("scenario-diagnostics")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("degraded session: no active reuse, visible in snapshot", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "enabled" })
		markJoyRideDegraded("scenario degraded")
		const scope = createTaskScope("scenario-degraded")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.isTrue(decision.degraded)
		assert.equal(decision.reasonCode, JOYRIDE_REASON.MISS_CACHE_DEGRADED)
		const snapshot = JSON.parse(createJoyRideBugReportSnapshot(cache))
		assert.isTrue(snapshot.degraded)
	})

	it("task cancellation: flush removes entries", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("scenario-cancel")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		assert.isAbove(cache.getStats().entryCount, 0)
		const flushed = flushTaskGeneration(cache, scope.taskId, "task_cancelled")
		assert.isAbove(flushed, 0)
		assert.equal(cache.getStats().entryCount, 0)
	})
})
