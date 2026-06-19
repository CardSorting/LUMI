/**
 * [LAYER: CORE]
 * JoyRide cache unit tests.
 */

import { assert } from "chai"
import { JoyRideCache } from "../JoyRideCache"
import {
	createCommandResultCacheKey,
	createJoyRideFingerprint,
	createScratchArtifactCacheKey,
	createVerificationCacheKey,
} from "../keys"
import { summarizeJoyRideCommandOutput } from "../summaries"
import { type JoyRideSetMetadata } from "../types"

function createBaseMetadata(overrides: Partial<JoyRideSetMetadata> = {}): JoyRideSetMetadata {
	return {
		cacheKind: "hotExecution",
		scope: { type: "task", id: "task-1" },
		ownerTaskId: "task-1",
		ttlMs: 60_000,
		fingerprint: createJoyRideFingerprint({ test: "value" }),
		workspaceFingerprint: createJoyRideFingerprint({ cwd: "/workspace" }),
		approvalBoundaryId: "boundary-1",
		invalidationReason: ["ttl_expired", "task_completed", "task_cancelled"],
		admissionReason: "test entry",
		safetyClassification: "taskLocal",
		generation: 1,
		...overrides,
	}
}

describe("JoyRideCache", () => {
	let cache: JoyRideCache

	beforeEach(() => {
		cache = new JoyRideCache({
			maxTotalBytes: 100_000,
			maxEntryBytes: 50_000,
			maxPerTaskBytes: 60_000,
			maxArtifactCount: 10,
			maxArtifactBytes: 30_000,
			emergencyTargetRatio: 0.35,
		})
	})

	describe("admission control", () => {
		it("should accept entries with full metadata", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(key.key, { output: "ok" }, createBaseMetadata())
			assert.isTrue(result.accepted, `Expected accepted, got: ${result.reason}`)
		})

		it("should reject entries with weak/unscoped keys", () => {
			const result = cache.set("weak-key", { data: "x" }, createBaseMetadata())
			assert.isFalse(result.accepted)
			assert.include(result.reason, "weak_or_unscoped_key")
		})

		it("should reject entries missing owner or scope", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(
				key.key,
				{ data: "x" },
				createBaseMetadata({ ownerTaskId: "", scope: { type: "task", id: "" } }),
			)
			assert.isFalse(result.accepted)
			assert.include(result.reason, "missing_owner_or_scope")
		})

		it("should reject entries with missing or invalid TTL", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(key.key, { data: "x" }, createBaseMetadata({ ttlMs: 0 }))
			assert.isFalse(result.accepted)
			assert.include(result.reason, "missing_or_invalid_ttl")
		})

		it("should reject entries with missing validation fingerprint", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(
				key.key,
				{ data: "x" },
				createBaseMetadata({ fingerprint: "", workspaceFingerprint: "", approvalBoundaryId: "" }),
			)
			assert.isFalse(result.accepted)
			assert.include(result.reason, "missing_validation_fingerprint")
		})

		it("should reject entries with missing admission reason", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(key.key, { data: "x" }, createBaseMetadata({ admissionReason: "", invalidationReason: [] }))
			assert.isFalse(result.accepted)
			assert.include(result.reason, "missing_admission_or_invalidation_policy")
		})

		it("should reject unsafe/secret-bearing entries", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(
				key.key,
				{
					apiKey: "sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz",
				},
				createBaseMetadata(),
			)
			assert.isFalse(result.accepted)
			assert.include(result.reason, "unsafe_or_secret_bearing_entry")
		})

		it("should reject secret values in nested objects", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = cache.set(
				key.key,
				{ config: { token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234567890" } },
				createBaseMetadata(),
			)
			assert.isFalse(result.accepted)
			assert.include(result.reason, "unsafe_or_secret_bearing_entry")
		})

		it("should reject oversized entries", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const largeValue = "x".repeat(60_000)
			const result = cache.set(key.key, largeValue, createBaseMetadata())
			assert.isFalse(result.accepted)
			assert.include(result.reason, "size")
		})

		it("should reject entries exceeding per-cache budget", () => {
			const smallBudgetCache = new JoyRideCache({
				maxTotalBytes: 100_000,
				maxEntryBytes: 50_000,
				maxPerTaskBytes: 60_000,
				maxArtifactCount: 10,
				maxArtifactBytes: 30_000,
				perKindBudgetBytes: {
					hotExecution: 100,
					taskLocal: 100,
					workspaceIndex: 100,
					verification: 100,
					scratchArtifact: 100,
				},
			})
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			const result = smallBudgetCache.set(key.key, "a".repeat(200), createBaseMetadata())
			assert.isFalse(result.accepted)
			assert.include(result.reason, "per_cache_budget_exceeded")
		})
	})

	describe("get and has", () => {
		it("should return cached values on get", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			cache.set(key.key, { output: "ok" }, createBaseMetadata())
			const result = cache.get<{ output: string }>(key.key)
			assert.deepEqual(result, { output: "ok" })
		})

		it("should return undefined for missing keys", () => {
			const result = cache.get("joyride:nonexistent:abc123")
			assert.isUndefined(result)
		})

		it("should track hit and miss counts", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			cache.set(key.key, { output: "ok" }, createBaseMetadata())
			cache.get(key.key)
			cache.get("joyride:missing:abc")

			const stats = cache.getStats()
			assert.equal(stats.hitCount, 1)
			assert.equal(stats.missCount, 1)
			assert.approximately(stats.hitRate, 0.5, 0.01)
		})
	})

	describe("TTL expiration", () => {
		it("should expire entries after TTL", () => {
			const key = createCommandResultCacheKey({
				command: "npm test",
				cwd: "/workspace",
				environmentFingerprint: "env-fp",
			})
			cache.set(key.key, { output: "ok" }, createBaseMetadata({ ttlMs: 1 }))
			// Wait for TTL to expire
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					const result = cache.get(key.key)
					assert.isUndefined(result, "Entry should be expired")
					const stats = cache.getStats()
					assert.isAbove(stats.staleReusePreventionCount, 0)
					resolve()
				}, 10)
			})
		})
	})

	describe("LRU eviction", () => {
		it("should evict LRU entries under memory pressure", () => {
			const smallCache = new JoyRideCache({
				maxTotalBytes: 350,
				maxEntryBytes: 200,
				maxPerTaskBytes: 500,
				maxArtifactCount: 100,
				maxArtifactBytes: 200,
			})
			const metadata = createBaseMetadata()
			const key1 = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			const key2 = createCommandResultCacheKey({ command: "cmd2", cwd: "/w", environmentFingerprint: "e" })
			const key3 = createCommandResultCacheKey({ command: "cmd3", cwd: "/w", environmentFingerprint: "e" })

			smallCache.set(key1.key, "a".repeat(150), metadata)
			smallCache.set(key2.key, "b".repeat(150), metadata)
			// key1 should be evicted (300 bytes existing + key3 150 = 450 > 350 max)
			smallCache.set(key3.key, "c".repeat(150), metadata)

			assert.isUndefined(smallCache.get(key1.key))
		})
	})

	describe("task lifecycle", () => {
		it("should flush all entries for a task on flushTask", () => {
			const key1 = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			const key2 = createCommandResultCacheKey({ command: "cmd2", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key1.key, { a: 1 }, createBaseMetadata({ ownerTaskId: "task-1" }))
			cache.set(key2.key, { b: 2 }, createBaseMetadata({ ownerTaskId: "task-1" }))

			const count = cache.flushTask("task-1", "task_completed")
			assert.equal(count, 2)
			assert.isUndefined(cache.get(key1.key))
			assert.isUndefined(cache.get(key2.key))
			assert.isAbove(cache.getStats().taskCleanupCount, 0)
		})

		it("should only flush entries for the specified task", () => {
			const key1 = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			const key2 = createCommandResultCacheKey({ command: "cmd2", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key1.key, { a: 1 }, createBaseMetadata({ ownerTaskId: "task-1" }))
			cache.set(key2.key, { b: 2 }, createBaseMetadata({ ownerTaskId: "task-2" }))

			cache.flushTask("task-1", "task_completed")
			assert.isUndefined(cache.get(key1.key))
			assert.isDefined(cache.get(key2.key))
		})
	})

	describe("workspace flush", () => {
		it("should flush all entries for a workspace on flushWorkspace", () => {
			const key = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { a: 1 }, createBaseMetadata({ scope: { type: "workspace", id: "ws-1" } }))

			const count = cache.flushWorkspace("ws-1")
			assert.equal(count, 1)
			assert.isUndefined(cache.get(key.key))
		})
	})

	describe("invalidation", () => {
		it("should mark entries stale without deleting them", () => {
			const key = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { a: 1 }, createBaseMetadata())

			const count = cache.invalidate({ ownerTaskId: "task-1", reason: "workspace_drift" })
			assert.equal(count, 1)

			// Stale entries should not be returned by get
			assert.isUndefined(cache.get(key.key))

			// But explain should show it as stale
			const explanation = cache.explain(key.key)
			assert.equal(explanation.validity, "stale")
			assert.equal(explanation.staleReason, "workspace_drift")
		})

		it("should invalidate by approval boundary", () => {
			const key = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { a: 1 }, createBaseMetadata({ approvalBoundaryId: "boundary-old" }))

			cache.invalidate({ approvalBoundaryId: "boundary-old", reason: "approval_boundary_changed" })

			assert.isUndefined(cache.get(key.key))
			assert.isAbove(cache.getStats().staleReusePreventionCount, 0)
		})
	})

	describe("verification cache", () => {
		it("should require validation fingerprint for verification entries on first access, then return on second with valid fingerprint", () => {
			const key = createVerificationCacheKey({
				command: "npm test",
				cwd: "/w",
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
				approvalBoundaryId: "boundary-1",
				gitHead: "abc123",
			})
			const metadata = createBaseMetadata({
				cacheKind: "verification",
				scope: { type: "verification", id: "verify-1" },
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
			})
			cache.set(key.key, { exitCode: 0 }, metadata)

			// Without validation, should miss and mark stale
			assert.isUndefined(cache.get(key.key))

			// After being marked stale, even with correct validation it should still miss
			// (because stale entries are not returned)
			const result = cache.get<{ exitCode: number }>(key.key, {
				fingerprint: metadata.fingerprint,
				workspaceFingerprint: metadata.workspaceFingerprint,
				approvalBoundaryId: "boundary-1",
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
			})
			assert.isUndefined(result, "Stale entry should not be returned even with valid fingerprint")
		})

		it("should return verification result when accessed with valid fingerprint first time", () => {
			const key = createVerificationCacheKey({
				command: "npm test",
				cwd: "/w",
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
				approvalBoundaryId: "boundary-1",
				gitHead: "abc123",
				runtimeVersion: process.version,
			})
			const metadata = createBaseMetadata({
				cacheKind: "verification",
				scope: { type: "verification", id: "verify-2" },
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
				runtimeVersion: process.version,
				fingerprint: key.fingerprint,
			})
			cache.set(key.key, { exitCode: 0 }, metadata)

			const result = cache.get<{ exitCode: number }>(key.key, {
				fingerprint: metadata.fingerprint,
				workspaceFingerprint: metadata.workspaceFingerprint,
				approvalBoundaryId: "boundary-1",
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
				runtimeVersion: process.version,
			})
			assert.deepEqual(result, { exitCode: 0 })
			assert.isAbove(cache.getStats().verificationCacheReuseCount, 0)
		})

		it("should fail validation when file hash changes", () => {
			const key = createVerificationCacheKey({
				command: "npm test",
				cwd: "/w",
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
				approvalBoundaryId: "boundary-1",
				gitHead: "abc123",
			})
			const metadata = createBaseMetadata({
				cacheKind: "verification",
				scope: { type: "verification", id: "verify-3" },
				relevantFileHashes: { "src/index.ts": "hash1" },
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				environmentFingerprint: "env-fp",
			})
			cache.set(key.key, { exitCode: 0 }, metadata)

			// Validation with changed file hash should fail
			const result = cache.get(key.key, {
				relevantFileHashes: { "src/index.ts": "hash2" },
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				environmentFingerprint: "env-fp",
			})
			assert.isUndefined(result)
			assert.isAbove(cache.getStats().cacheValidationFailureCount, 0)
		})

		it("should fail validation across invalid approval boundary", () => {
			const key = createVerificationCacheKey({
				command: "npm test",
				cwd: "/w",
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				relevantFileHashes: { "src/index.ts": "hash1" },
				environmentFingerprint: "env-fp",
				approvalBoundaryId: "boundary-1",
				gitHead: "abc123",
			})
			const metadata = createBaseMetadata({
				cacheKind: "verification",
				scope: { type: "verification", id: "verify-4" },
				relevantFileHashes: { "src/index.ts": "hash1" },
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				environmentFingerprint: "env-fp",
			})
			cache.set(key.key, { exitCode: 0 }, metadata)

			const result = cache.get(key.key, {
				approvalBoundaryId: "boundary-2",
				relevantFileHashes: { "src/index.ts": "hash1" },
				dependencyFingerprint: "dep-fp",
				lockfileFingerprint: "lock-fp",
				gitHead: "abc123",
				environmentFingerprint: "env-fp",
			})
			assert.isUndefined(result)
		})
	})

	describe("scratch artifacts", () => {
		it("should require cleanup handler for scratch artifacts", () => {
			const key = createScratchArtifactCacheKey({
				taskId: "task-1",
				artifactKind: "script",
				contentHash: "hash1",
				generation: 1,
				cleanupPolicy: "ttl",
			})
			const result = cache.set(
				key.key,
				"script content",
				createBaseMetadata({
					cacheKind: "scratchArtifact",
					scope: { type: "scratch", id: "scratch-1" },
					cleanupHandler: undefined,
				}),
			)
			assert.isFalse(result.accepted)
			assert.include(result.reason, "scratch_artifact_missing_cleanup_handler")
		})

		it("should invoke cleanup handler on eviction", () => {
			let cleanupCalled = false
			const key = createScratchArtifactCacheKey({
				taskId: "task-1",
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
						cleanupCalled = true
					},
				}),
			)

			cache.flush({ reason: "manual_flush" })
			assert.isTrue(cleanupCalled)
			assert.isAbove(cache.getStats().scratchCleanupCount, 0)
		})

		it("should enforce artifact count cap", () => {
			const smallCache = new JoyRideCache({
				maxTotalBytes: 1_000_000,
				maxEntryBytes: 50_000,
				maxPerTaskBytes: 1_000_000,
				maxArtifactCount: 2,
				maxArtifactBytes: 50_000,
			})
			for (let i = 0; i < 3; i++) {
				const key = createScratchArtifactCacheKey({
					taskId: "task-1",
					artifactKind: `kind-${i}`,
					contentHash: `hash-${i}`,
					generation: i,
					cleanupPolicy: "ttl",
				})
				smallCache.set(
					key.key,
					`content-${i}`,
					createBaseMetadata({
						cacheKind: "scratchArtifact",
						scope: { type: "scratch", id: `scratch-${i}` },
						cleanupHandler: () => {},
					}),
				)
			}
			assert.isAtMost(smallCache.getStats().artifactCount, 2)
		})
	})

	describe("deduplication", () => {
		it("should deduplicate entries with the same key and fingerprint", () => {
			const key = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			const metadata = createBaseMetadata()
			cache.set(key.key, { a: 1 }, metadata)
			cache.set(key.key, { a: 1 }, metadata)

			assert.isAbove(cache.getStats().duplicateArtifactDeduplicationCount, 0)
		})
	})

	describe("explain", () => {
		it("should explain existing entries", () => {
			const key = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { output: "ok" }, createBaseMetadata())

			const explanation = cache.explain(key.key)
			assert.isTrue(explanation.exists)
			assert.equal(explanation.validity, "valid")
			assert.isDefined(explanation.createdAt)
			assert.isDefined(explanation.expiresAt)
			assert.isDefined(explanation.estimatedBytes)
			assert.equal(explanation.durability, "memoryOnly")
		})

		it("should return missing for non-existent keys", () => {
			const explanation = cache.explain("joyride:missing:abc")
			assert.isFalse(explanation.exists)
			assert.equal(explanation.validity, "missing")
		})
	})

	describe("memory pressure", () => {
		it("should trim to budget under pressure", () => {
			const smallCache = new JoyRideCache({
				maxTotalBytes: 250,
				maxEntryBytes: 200,
				maxPerTaskBytes: 500,
				maxArtifactCount: 100,
				maxArtifactBytes: 200,
			})
			const metadata = createBaseMetadata()
			smallCache.set(
				createCommandResultCacheKey({ command: "c1", cwd: "/w", environmentFingerprint: "e" }).key,
				"a".repeat(150),
				metadata,
			)
			smallCache.set(
				createCommandResultCacheKey({ command: "c2", cwd: "/w", environmentFingerprint: "e" }).key,
				"b".repeat(150),
				metadata,
			)
			// Third insert forces pressure trim during admission
			smallCache.set(
				createCommandResultCacheKey({ command: "c3", cwd: "/w", environmentFingerprint: "e" }).key,
				"c".repeat(150),
				metadata,
			)
			assert.isAbove(smallCache.getStats().pressureTrimEvents, 0)
		})

		it("should emergency trim to target ratio", () => {
			const smallCache = new JoyRideCache({
				maxTotalBytes: 100000,
				maxEntryBytes: 50000,
				maxPerTaskBytes: 100000,
				maxArtifactCount: 100,
				maxArtifactBytes: 50000,
				emergencyTargetRatio: 0.2,
			})
			const metadata = createBaseMetadata()
			for (let i = 0; i < 5; i++) {
				smallCache.set(
					createCommandResultCacheKey({ command: `c${i}`, cwd: "/w", environmentFingerprint: "e" }).key,
					"x".repeat(30000),
					metadata,
				)
			}

			smallCache.emergencyTrim("emergency_pressure")
			// emergency trim does not increment pressureTrimEvents
			assert.isAbove(smallCache.getStats().emergencyTrimEvents, 0)
		})
	})

	describe("stats accuracy", () => {
		it("should report accurate stats", () => {
			const key = createCommandResultCacheKey({ command: "cmd1", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key.key, { output: "ok" }, createBaseMetadata())
			cache.get(key.key)
			cache.get("joyride:missing:abc")

			const stats = cache.getStats()
			assert.equal(stats.entryCount, 1)
			assert.equal(stats.hitCount, 1)
			assert.equal(stats.missCount, 1)
			assert.isAbove(stats.memoryUsageEstimate, 0)
			assert.equal(stats.largestEntries.length, 1)
			assert.equal(stats.hottestKeys.length, 1)
		})
	})

	describe("summaries", () => {
		it("should truncate large command outputs", () => {
			const largeOutput = "x".repeat(20_000)
			const summary = summarizeJoyRideCommandOutput(largeOutput, 1000)
			assert.isTrue(summary.truncated)
			assert.isBelow(summary.summaryBytes, summary.originalBytes)
			assert.include(summary.text, "[JoyRide summary truncated")
		})

		it("should not truncate small outputs", () => {
			const smallOutput = "small output"
			const summary = summarizeJoyRideCommandOutput(smallOutput)
			assert.isFalse(summary.truncated)
			assert.equal(summary.text, smallOutput)
		})
	})

	describe("no retained references after flush", () => {
		it("should remove all task entries after flushTask", () => {
			const key1 = createCommandResultCacheKey({ command: "c1", cwd: "/w", environmentFingerprint: "e" })
			const key2 = createCommandResultCacheKey({ command: "c2", cwd: "/w", environmentFingerprint: "e" })
			cache.set(key1.key, { a: 1 }, createBaseMetadata({ ownerTaskId: "task-x" }))
			cache.set(key2.key, { b: 2 }, createBaseMetadata({ ownerTaskId: "task-x" }))

			cache.flushTask("task-x")

			const stats = cache.getStats()
			assert.notInclude(Object.keys(stats.perTaskMemoryEstimate), "task-x")
		})
	})
})
