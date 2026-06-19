/**
 * [LAYER: CORE]
 * Config mode contract — no bypass of disabled, diagnostics-only, or feature flags.
 */

import { assert } from "chai"
import { setJoyRideConfig } from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { lookupSafeCommandResult, lookupSearchResult, storeReusableCommandResult, storeSearchResult } from "../JoyRideHotPath"
import { storeScratchArtifactWithCleanup } from "../JoyRideScratch"
import { assertDecisionInvariants, createJoyRideTestCache, createTaskScope } from "./JoyRideTestHelpers"

describe("JoyRide config contract", () => {
	const scope = () => createTaskScope("config-contract")
	let cache: ReturnType<typeof createJoyRideTestCache>

	beforeEach(() => {
		cache = createJoyRideTestCache()
		const s = scope()
		cache.registerTask(s.taskId, s.generation)
	})

	it("disabled mode: no storage, no reuse on command lookup", async () => {
		const s = scope()
		setJoyRideConfig({ mode: "disabled" })
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], s)
		assert.equal(cache.getStats().entryCount, 0)
		const decision = await lookupSafeCommandResult(cache, "pwd", s)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
		assert.equal(decision.type, "disabled")
	})

	it("diagnostics-only mode: stores but never reuses", async () => {
		setJoyRideConfig({ mode: "diagnostics-only" })
		const s = scope()
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], s)
		assert.isAbove(cache.getStats().entryCount, 0)
		const decision = await lookupSafeCommandResult(cache, "pwd", s)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("command reuse disabled: no command skip", async () => {
		setJoyRideConfig({ mode: "enabled", commandReuseDisabled: true })
		const s = scope()
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], s)
		const decision = await lookupSafeCommandResult(cache, "pwd", s)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("search cache disabled: no search reuse", async () => {
		setJoyRideConfig({ mode: "enabled", searchCacheDisabled: true })
		const s = scope()
		const opts = { cwd: process.cwd() }
		await storeSearchResult(cache, "q", opts, "r", 1, s)
		const decision = await lookupSearchResult(cache, "q", opts, s)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("scratch cache disabled: rejects scratch storage", async () => {
		setJoyRideConfig({ mode: "enabled", scratchCacheDisabled: true })
		const s = scope()
		const decision = await storeScratchArtifactWithCleanup(
			cache,
			{
				artifactKind: "temp",
				ownerTaskId: s.taskId,
				ttlMs: 60_000,
				estimatedBytes: 128,
				cleanupHandler: () => {},
			},
			{ data: 1 },
			s,
		)
		assertDecisionInvariants(decision)
		assert.equal(decision.type, "rejected")
		assert.equal(decision.fallbackBehavior, "rejectArtifact")
	})
})
