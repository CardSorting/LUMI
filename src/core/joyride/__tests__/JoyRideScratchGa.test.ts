/**
 * [LAYER: CORE]
 * Scratch artifact lifecycle — GA final pass.
 */

import { assert } from "chai"
import { setJoyRideConfig } from "../JoyRideConfig"
import { flushTaskGeneration, shutdownJoyRide } from "../JoyRideLifecycle"
import { storeScratchArtifactWithCleanup } from "../JoyRideScratch"
import { assertDecisionInvariants, createJoyRideTestCache, createTaskScope } from "./JoyRideTestHelpers"

describe("JoyRide scratch GA lifecycle", () => {
	it("should reject scratch without cleanup handler", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("scratch-no-cleanup")
		const decision = await storeScratchArtifactWithCleanup(
			cache,
			{
				artifactKind: "temp",
				ownerTaskId: scope.taskId,
				ttlMs: 60_000,
				estimatedBytes: 128,
				cleanupHandler: undefined as unknown as () => void,
			},
			{ x: 1 },
			scope,
		)
		assert.equal(decision.type, "rejected")
	})

	it("should reject scratch without owner", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("scratch-no-owner")
		const decision = await storeScratchArtifactWithCleanup(
			cache,
			{
				artifactKind: "temp",
				ownerTaskId: "",
				ttlMs: 60_000,
				estimatedBytes: 128,
				cleanupHandler: () => {},
			},
			{ x: 1 },
			scope,
		)
		assert.equal(decision.type, "rejected")
	})

	it("should reject when scratch cache disabled", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "enabled", scratchCacheDisabled: true })
		const scope = createTaskScope("scratch-disabled")
		const decision = await storeScratchArtifactWithCleanup(
			cache,
			{
				artifactKind: "temp",
				ownerTaskId: scope.taskId,
				ttlMs: 60_000,
				estimatedBytes: 128,
				cleanupHandler: () => {},
			},
			{ x: 1 },
			scope,
		)
		assertDecisionInvariants(decision)
		assert.equal(decision.type, "rejected")
		assert.equal(decision.fallbackBehavior, "rejectArtifact")
	})

	it("should cleanup on task flush and shutdown", async () => {
		let count = 0
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("scratch-lifecycle")
		cache.registerTask(scope.taskId, scope.generation)
		await storeScratchArtifactWithCleanup(
			cache,
			{
				artifactKind: "temp",
				ownerTaskId: scope.taskId,
				ttlMs: 60_000,
				estimatedBytes: 128,
				cleanupHandler: () => {
					count++
				},
			},
			{ x: 1 },
			scope,
		)
		flushTaskGeneration(cache, scope.taskId, "task_completed")
		assert.equal(count, 1)
		shutdownJoyRide(cache)
	})
})
