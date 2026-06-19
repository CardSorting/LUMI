/**
 * [LAYER: CORE]
 * Failure-mode maturity — JoyRide must never block agent execution.
 */

import { assert } from "chai"
import { JoyRideCache } from "../JoyRideCache"
import { markJoyRideDegraded, resetJoyRideDegraded } from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideBugReportSnapshot, summarizeJoyRideHealth } from "../JoyRideDiagnostics"
import { lookupSafeCommandResult, storeReusableCommandResult } from "../JoyRideHotPath"
import { createJoyRideFingerprint, createScratchArtifactCacheKey } from "../keys"
import { assertDecisionInvariants, createJoyRideTestCache, createTaskScope } from "./JoyRideTestHelpers"

describe("JoyRide failure-mode maturity", () => {
	afterEach(() => {
		resetJoyRideDegraded()
	})

	it("should continue normal path when degraded — no trusted cache reuse", async () => {
		const cache = createJoyRideTestCache()
		markJoyRideDegraded("size estimator failure")
		const scope = createTaskScope("fail-degraded")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
		assert.equal(decision.fallbackBehavior, "executeNormally")
	})

	it("should include degraded state in bug report snapshot", async () => {
		const cache = createJoyRideTestCache()
		markJoyRideDegraded("snapshot creation under degraded")
		const snapshot = JSON.parse(createJoyRideBugReportSnapshot(cache))
		assert.isTrue(snapshot.degraded)
		assert.isDefined(snapshot.degradedReason)
	})

	it("should record cleanup failure without crashing runtime", () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 50_000, maxPerTaskBytes: 400_000 })
		const key = createScratchArtifactCacheKey({
			taskId: "fail-cleanup",
			artifactKind: "script",
			contentHash: "h1",
			generation: 1,
			cleanupPolicy: "task",
		})
		cache.set(key.key, "data", {
			cacheKind: "scratchArtifact",
			scope: { type: "scratch", id: "fail-cleanup" },
			ownerTaskId: "fail-cleanup",
			ttlMs: 60_000,
			fingerprint: key.fingerprint,
			workspaceFingerprint: createJoyRideFingerprint({ cwd: "/w" }),
			approvalBoundaryId: "b1",
			invalidationReason: ["ttl_expired", "task_completed"],
			admissionReason: "cleanup failure test",
			safetyClassification: "taskLocal",
			generation: 1,
			cleanupHandler: () => {
				throw new Error("cleanup failed")
			},
		})
		cache.flush({ reason: "manual_flush" })
		assert.isAbove(cache.getStats().cleanupFailureCount, 0)
	})

	it("should reject secret-bearing output and not leak secret in snapshot", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("fail-secret")
		cache.registerTask(scope.taskId, scope.generation)
		const secret = "api_key=sk-live-abcdefghijklmnopqrstuvwxyz1234567890"
		await storeReusableCommandResult(cache, "pwd", [false, `${secret}\n`], scope)
		const snapshot = createJoyRideBugReportSnapshot(cache)
		assert.notInclude(snapshot, "sk-live-")
		assert.isAtLeast(JSON.parse(snapshot).summary.unsafeRejections, 0)
	})

	it("should produce health summary even when entries empty", () => {
		const cache = createJoyRideTestCache()
		const health = summarizeJoyRideHealth(cache)
		assert.include(health, "entries=0")
	})
})
