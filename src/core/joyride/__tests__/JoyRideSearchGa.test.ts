/**
 * [LAYER: CORE]
 * Search and workspace invalidation — GA final pass.
 */

import { assert } from "chai"
import { lookupSearchResult, storeSearchResult } from "../JoyRideHotPath"
import { createGrepResultCacheKey } from "../keys"
import { createJoyRideTestCache, createTaskScope, expectCacheHit, expectNoActiveReuse } from "./JoyRideTestHelpers"

describe("JoyRide search GA invalidation", () => {
	it("should miss when query changes", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("search-query")
		cache.registerTask(scope.taskId, scope.generation)
		const opts = { cwd: scope.cwd, includeGlobs: ["*.ts"] as string[] }
		await storeSearchResult(cache, "foo", opts, "Found 1", 1, scope)
		const hit = await lookupSearchResult(cache, "foo", opts, scope)
		expectCacheHit(hit)
		const miss = await lookupSearchResult(cache, "bar", opts, scope)
		expectNoActiveReuse(miss)
	})

	it("should miss when include glob changes", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("search-glob")
		cache.registerTask(scope.taskId, scope.generation)
		const base = { cwd: scope.cwd }
		await storeSearchResult(cache, "export", { ...base, includeGlobs: ["*.ts"] }, "Found 1", 1, scope)
		const miss = await lookupSearchResult(cache, "export", { ...base, includeGlobs: ["*.tsx"] }, scope)
		expectNoActiveReuse(miss)
	})

	it("should miss when changed-file generation changes", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("search-gen")
		cache.registerTask(scope.taskId, scope.generation)
		const opts = { cwd: scope.cwd, includeGlobs: ["*.ts"] as string[] }
		await storeSearchResult(cache, "lint", opts, "Found 2", 2, scope, 0)
		const hit = await lookupSearchResult(cache, "lint", opts, scope, 0)
		expectCacheHit(hit)
		const miss = await lookupSearchResult(cache, "lint", opts, scope, 1)
		expectNoActiveReuse(miss)
	})

	it("should produce distinct keys for search dimensions", () => {
		const base = { query: "q", cwd: "/w", includeGlobs: ["*.ts"], excludeGlobs: ["node_modules"] }
		const k1 = createGrepResultCacheKey({ ...base, changedFileGeneration: 0, workspaceFingerprint: "ws1" })
		const k2 = createGrepResultCacheKey({ ...base, changedFileGeneration: 1, workspaceFingerprint: "ws1" })
		const k3 = createGrepResultCacheKey({ ...base, changedFileGeneration: 0, workspaceFingerprint: "ws2" })
		assert.notEqual(k1.key, k2.key)
		assert.notEqual(k1.key, k3.key)
	})
})
