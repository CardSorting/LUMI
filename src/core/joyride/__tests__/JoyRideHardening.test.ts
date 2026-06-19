/**
 * [LAYER: CORE]
 * JoyRide production hardening tests.
 */

import { assert } from "chai"
import { JoyRideCache } from "../JoyRideCache"
import { createCommandResultCacheKey, createJoyRideFingerprint, createScratchArtifactCacheKey } from "../keys"
import { type JoyRideSetMetadata } from "../types"

function createBaseMetadata(overrides: Partial<JoyRideSetMetadata> = {}): JoyRideSetMetadata {
	return {
		cacheKind: "hotExecution",
		scope: { type: "task", id: "task-h1" },
		ownerTaskId: "task-h1",
		ttlMs: 60_000,
		fingerprint: createJoyRideFingerprint({ test: "value" }),
		workspaceFingerprint: createJoyRideFingerprint({ cwd: "/workspace" }),
		approvalBoundaryId: "boundary-1",
		invalidationReason: ["ttl_expired", "task_completed"],
		admissionReason: "test entry",
		safetyClassification: "taskLocal",
		generation: 1,
		...overrides,
	}
}

describe("JoyRide hardening", () => {
	describe("task generation guards", () => {
		it("should reject writes from obsolete task generation", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 100_000, maxEntryBytes: 50_000, maxPerTaskBytes: 60_000 })
			cache.registerTask("task-h1", 5)
			const key = createCommandResultCacheKey({ command: "pwd", cwd: "/w", environmentFingerprint: "e" })
			const result = cache.trySet(key.key, { output: "ok" }, createBaseMetadata({ generation: 3 }))
			assert.isFalse(result.accepted)
			assert.include(result.reason, "late_write")
		})
	})

	describe("secret scanning edge cases", () => {
		it("should reject private key material", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 100_000, maxEntryBytes: 50_000, maxPerTaskBytes: 60_000 })
			const key = createCommandResultCacheKey({ command: "cat key", cwd: "/w", environmentFingerprint: "e" })
			const result = cache.set(key.key, { output: "-----BEGIN RSA PRIVATE KEY-----\nMIIE..." }, createBaseMetadata())
			assert.isFalse(result.accepted)
		})

		it("should reject bearer tokens in output", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 100_000, maxEntryBytes: 50_000, maxPerTaskBytes: 60_000 })
			const key = createCommandResultCacheKey({ command: "curl", cwd: "/w", environmentFingerprint: "e" })
			const result = cache.set(key.key, "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890", createBaseMetadata())
			assert.isFalse(result.accepted)
		})
	})

	describe("scratch cleanup idempotency", () => {
		it("should invoke cleanup exactly once on flush", () => {
			let cleanupCount = 0
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 50_000, maxPerTaskBytes: 400_000 })
			const key = createScratchArtifactCacheKey({
				taskId: "task-h1",
				artifactKind: "script",
				contentHash: "hash1",
				generation: 1,
				cleanupPolicy: "ttl",
			})
			cache.set(
				key.key,
				"script content",
				createBaseMetadata({
					cacheKind: "scratchArtifact",
					scope: { type: "scratch", id: "scratch-1" },
					cleanupHandler: () => {
						cleanupCount++
					},
				}),
			)
			cache.flush({ reason: "manual_flush" })
			cache.flush({ reason: "manual_flush" })
			assert.equal(cleanupCount, 1)
		})

		it("should record cleanup failure without crashing", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 50_000, maxPerTaskBytes: 400_000 })
			const key = createScratchArtifactCacheKey({
				taskId: "task-h1",
				artifactKind: "script",
				contentHash: "hash2",
				generation: 1,
				cleanupPolicy: "ttl",
			})
			cache.set(
				key.key,
				"script content",
				createBaseMetadata({
					cacheKind: "scratchArtifact",
					scope: { type: "scratch", id: "scratch-2" },
					cleanupHandler: () => {
						throw new Error("cleanup failed")
					},
				}),
			)
			cache.flush({ reason: "manual_flush" })
			assert.isAbove(cache.getStats().cleanupFailureCount, 0)
		})
	})

	describe("observability", () => {
		it("should expose canReuse and reuseBlockReason in explain", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 100_000, maxEntryBytes: 50_000, maxPerTaskBytes: 60_000 })
			const key = createCommandResultCacheKey({ command: "pwd", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { output: "ok" }, createBaseMetadata())
			const explanation = cache.explain(key.key)
			assert.isTrue(explanation.canReuse)
			assert.isUndefined(explanation.reuseBlockReason)
		})

		it("should report stale reuse block reason after invalidation", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 100_000, maxEntryBytes: 50_000, maxPerTaskBytes: 60_000 })
			const key = createCommandResultCacheKey({ command: "pwd", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { output: "ok" }, createBaseMetadata())
			cache.invalidate({ ownerTaskId: "task-h1", reason: "workspace_drift" })
			const explanation = cache.explain(key.key)
			assert.equal(explanation.validity, "stale")
			assert.isFalse(explanation.canReuse)
			assert.equal(explanation.reuseBlockReason, "workspace_drift")
		})

		it("should track ttl and lru eviction counts separately", () => {
			const cache = new JoyRideCache({
				maxTotalBytes: 250,
				maxEntryBytes: 200,
				maxPerTaskBytes: 500,
			})
			const metadata = createBaseMetadata()
			const key1 = createCommandResultCacheKey({ command: "c1", cwd: "/w", environmentFingerprint: "e" })
			const key2 = createCommandResultCacheKey({ command: "c2", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key1.key, "a".repeat(150), { ...metadata, ttlMs: 1 })
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					cache.trimToBudget()
					cache.set(key2.key, "b".repeat(150), metadata)
					cache.set(
						createCommandResultCacheKey({ command: "c3", cwd: "/w", environmentFingerprint: "e" }).key,
						"c".repeat(150),
						metadata,
					)
					const stats = cache.getStats()
					assert.isAbove(stats.ttlEvictionCount + stats.lruEvictionCount, 0)
					resolve()
				}, 15)
			})
		})
	})

	describe("memory pressure stress", () => {
		it("should survive thousands of small entries under budget", () => {
			const cache = new JoyRideCache({
				maxTotalBytes: 5_000,
				maxEntryBytes: 200,
				maxPerTaskBytes: 5_000,
			})
			const metadata = createBaseMetadata()
			for (let i = 0; i < 200; i++) {
				const key = createCommandResultCacheKey({ command: `cmd-${i}`, cwd: "/w", environmentFingerprint: "e" })
				cache.set(key.key, "x".repeat(120), metadata)
			}
			const stats = cache.getStats()
			assert.isAtMost(stats.memoryUsageEstimate, 5_000)
			assert.isAbove(stats.evictionCount + stats.pressureTrimEvents, 0)
		})
	})
})
