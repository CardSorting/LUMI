/**
 * [LAYER: CORE]
 * JoyRide operational modes and kill switch tests.
 */

import { assert } from "chai"
import { clearJoyRideCacheHitAuditTrail, getJoyRideCacheHitAuditTrail } from "../JoyRideAudit"
import { JoyRideCache } from "../JoyRideCache"
import {
	canJoyRideReuseCommands,
	canJoyRideSkipWork,
	canJoyRideStore,
	resetJoyRideConfig,
	setJoyRideConfig,
} from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideTaskScope, lookupSafeCommandResult, storeReusableCommandResult } from "../JoyRideHotPath"
import { createJoyRideFingerprint, createScratchArtifactCacheKey } from "../keys"

describe("JoyRide operational modes", () => {
	let cache: JoyRideCache

	beforeEach(() => {
		resetJoyRideConfig()
		clearJoyRideCacheHitAuditTrail()
		cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
	})

	afterEach(() => {
		resetJoyRideConfig()
	})

	it("disabled mode performs no active reuse and no storage", async () => {
		setJoyRideConfig({ mode: "disabled" })
		assert.isFalse(canJoyRideSkipWork())
		assert.isFalse(canJoyRideStore())

		const scope = createJoyRideTaskScope("task-mode-1", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/tmp\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assert.isFalse(decision.canReuse)
		assert.equal(decision.type, "disabled")
		assert.equal(cache.getStats().entryCount, 0)
	})

	it("diagnostics-only mode stores but never skips work", async () => {
		setJoyRideConfig({ mode: "diagnostics-only" })
		assert.isFalse(canJoyRideSkipWork())
		assert.isTrue(canJoyRideStore())

		const scope = createJoyRideTaskScope("task-mode-2", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/tmp\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assert.isFalse(decision.canReuse)
		assert.equal(decision.type, "disabled")
		assert.isAbove(cache.getStats().entryCount, 0)
	})

	it("command-reuse-disabled mode never skips command execution", async () => {
		setJoyRideConfig({ mode: "enabled", commandReuseDisabled: true })
		assert.isFalse(canJoyRideReuseCommands())

		const scope = createJoyRideTaskScope("task-mode-3", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/tmp\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assert.isFalse(decision.canReuse)
	})

	it("verification-cache-disabled mode never reuses verification", async () => {
		setJoyRideConfig({ mode: "enabled", verificationCacheDisabled: true })
		const scope = createJoyRideTaskScope("task-mode-4", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "ok\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope, 0, { "src/a.ts": "hash1" })
		assert.isFalse(decision.canReuse)
	})

	it("scratch-cache-disabled rejects scratch artifacts", () => {
		setJoyRideConfig({ mode: "enabled", scratchCacheDisabled: true })
		const key = createScratchArtifactCacheKey({
			taskId: "task-mode-5",
			artifactKind: "script",
			contentHash: "h1",
			generation: 1,
			cleanupPolicy: "ttl",
		})
		const result = cache.trySet(key.key, "content", {
			cacheKind: "scratchArtifact",
			scope: { type: "scratch", id: "s1" },
			ownerTaskId: "task-mode-5",
			ttlMs: 60_000,
			fingerprint: key.fingerprint,
			workspaceFingerprint: createJoyRideFingerprint({ cwd: "/w" }),
			approvalBoundaryId: "b1",
			invalidationReason: ["ttl_expired"],
			admissionReason: "test",
			safetyClassification: "taskLocal",
			generation: 1,
			cleanupHandler: () => {},
		})
		assert.isFalse(result.accepted)
		assert.include(result.reason, "scratch_cache_disabled")
	})

	it("records audit trail on cache hit", async () => {
		setJoyRideConfig({ mode: "enabled" })
		const scope = createJoyRideTaskScope("task-mode-6", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/tmp\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assert.isTrue(isJoyRideHitDecision(decision))
		const trail = getJoyRideCacheHitAuditTrail()
		assert.isAtLeast(trail.length, 1)
		assert.equal(trail[trail.length - 1].hitSource, "command")
	})
})
