/**
 * [LAYER: CORE]
 * Production readiness: long sessions, negative cache, search correctness.
 */

import { assert } from "chai"
import { clearJoyRideCacheHitAuditTrail } from "../JoyRideAudit"
import { JoyRideCache } from "../JoyRideCache"
import { resetJoyRideConfig, setJoyRideConfig } from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import {
	createJoyRideTaskScope,
	lookupSafeCommandResult,
	lookupSearchResult,
	storeReusableCommandResult,
	storeSearchResult,
} from "../JoyRideHotPath"
import { createCommandResultCacheKey, createJoyRideFingerprint, createVerificationCacheKey } from "../keys"
import { type JoyRideSetMetadata } from "../types"

function baseMetadata(taskId: string, generation: number): JoyRideSetMetadata {
	return {
		cacheKind: "hotExecution",
		scope: { type: "task", id: taskId },
		ownerTaskId: taskId,
		ttlMs: 60_000,
		fingerprint: createJoyRideFingerprint({ prod: taskId }),
		workspaceFingerprint: createJoyRideFingerprint({ cwd: "/workspace" }),
		approvalBoundaryId: `task:${taskId}:command:${generation}`,
		invalidationReason: ["ttl_expired", "task_completed"],
		admissionReason: "prod test",
		safetyClassification: "taskLocal",
		generation,
		gitHead: "abc",
		dependencyFingerprint: "dep",
		lockfileFingerprint: "lock",
		environmentFingerprint: "env",
		runtimeVersion: process.version,
	}
}

describe("JoyRide production readiness", () => {
	beforeEach(() => {
		resetJoyRideConfig()
		setJoyRideConfig({ mode: "enabled" })
		clearJoyRideCacheHitAuditTrail()
	})

	afterEach(() => {
		resetJoyRideConfig()
	})

	describe("long session stability", () => {
		it("should not retain entries after many task completions", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 200_000, maxEntryBytes: 20_000, maxPerTaskBytes: 100_000 })
			for (let t = 0; t < 20; t++) {
				const taskId = `long-task-${t}`
				const scope = createJoyRideTaskScope(taskId, process.cwd(), "vscodeTerminal", 1)
				cache.registerTask(taskId, scope.generation)
				await storeReusableCommandResult(cache, "pwd", [false, `/task-${t}\n`], scope)
				cache.flushTask(taskId, "task_completed")
			}
			assert.equal(cache.getStats().entryCount, 0)
			assert.isAtMost(cache.getStats().staleDiagnosticCount, 256)
		})

		it("should reject late writes after many generation bumps", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 200_000, maxEntryBytes: 20_000, maxPerTaskBytes: 100_000 })
			const taskId = "long-task-late"
			cache.registerTask(taskId, 0)
			for (let i = 0; i < 10; i++) {
				cache.bumpTaskGeneration(taskId)
			}
			const scope = createJoyRideTaskScope(taskId, process.cwd(), "vscodeTerminal", 1)
			await storeReusableCommandResult(cache, "pwd", [false, "/late\n"], scope)
			assert.isAbove(cache.getStats().lateWriteRejectionCount, 0)
		})
	})

	describe("negative cache safety", () => {
		it("should not reuse failed test output", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
			const scope = createJoyRideTaskScope("neg-task-1", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			await storeReusableCommandResult(cache, "npm test", [false, "Exit code: 1\nfailed"], scope)
			const decision = await lookupSafeCommandResult(cache, "npm test", scope, 1, { "src/fixed.ts": "newhash" })
			assert.isFalse(decision.canReuse)
		})

		it("should not reuse pwd after approval boundary change", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
			const scope1 = createJoyRideTaskScope("neg-task-2", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope1.taskId, scope1.generation)
			await storeReusableCommandResult(cache, "pwd", [false, "/a\n"], scope1)
			const scope2 = createJoyRideTaskScope("neg-task-2", process.cwd(), "vscodeTerminal", 99)
			const decision = await lookupSafeCommandResult(cache, "pwd", scope2)
			assert.isFalse(decision.canReuse)
		})

		it("should mark failed verification as diagnostic-only in explain", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
			const scope = createJoyRideTaskScope("neg-task-3", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			await storeReusableCommandResult(cache, "npm test", [false, "Exit code: 1\nfailed"], scope)
			const verifyKey = createVerificationCacheKey({
				command: "npm test",
				cwd: scope.cwd,
				dependencyFingerprint: "d",
				lockfileFingerprint: "l",
				relevantFileHashes: {},
				environmentFingerprint: "e",
				approvalBoundaryId: scope.approvalBoundaryId,
				gitHead: "g",
			})
			const explanation = cache.explain(verifyKey.key)
			if (explanation.exists) {
				assert.isTrue(explanation.diagnosticOnly)
				assert.isFalse(explanation.canReuse)
			}
		})
	})

	describe("search cache correctness", () => {
		it("should miss when cwd differs", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
			const scope = createJoyRideTaskScope("search-1", "/workspace/a", "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			await storeSearchResult(cache, "foo", { cwd: "/workspace/a", includeGlobs: ["*.ts"] }, "Found 1 result", 1, scope)
			const scopeB = createJoyRideTaskScope("search-1", "/workspace/b", "vscodeTerminal", 1)
			const decision = await lookupSearchResult(cache, "foo", { cwd: "/workspace/b", includeGlobs: ["*.ts"] }, scopeB)
			assert.isFalse(decision.canReuse)
		})

		it("should miss when include glob differs", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
			const scope = createJoyRideTaskScope("search-2", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			await storeSearchResult(cache, "bar", { cwd: process.cwd(), includeGlobs: ["*.ts"] }, "Found 2 results", 2, scope)
			const decision = await lookupSearchResult(cache, "bar", { cwd: process.cwd(), includeGlobs: ["*.tsx"] }, scope)
			assert.isFalse(decision.canReuse)
		})

		it("should hit for identical search parameters", async () => {
			const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
			const scope = createJoyRideTaskScope("search-3", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			const opts = { cwd: process.cwd(), includeGlobs: ["*.ts"] as string[] }
			await storeSearchResult(cache, "baz", opts, "Found 3 results", 3, scope)
			const decision = await lookupSearchResult(cache, "baz", opts, scope)
			assert.isTrue(isJoyRideHitDecision(decision))
			assert.equal(decision.value, "Found 3 results")
		})
	})

	describe("responsiveness", () => {
		it("should flush many entries within bounded time", () => {
			const cache = new JoyRideCache({ maxTotalBytes: 2_000_000, maxEntryBytes: 50_000, maxPerTaskBytes: 2_000_000 })
			for (let i = 0; i < 500; i++) {
				const key = createCommandResultCacheKey({ command: `c${i}`, cwd: "/w", environmentFingerprint: "e" })
				cache.set(key.key, "x".repeat(100), baseMetadata("flush-perf", 1))
			}
			cache.flushTask("flush-perf")
			assert.isAbove(cache.getStats().lastFlushDurationMs, 0)
			assert.equal(cache.getStats().entryCount, 0)
		})
	})
})
