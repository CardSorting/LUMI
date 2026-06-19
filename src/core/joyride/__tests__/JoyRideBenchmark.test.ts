/**
 * [LAYER: CORE]
 * Lightweight JoyRide performance regression gates (generous thresholds).
 */

import { assert } from "chai"
import { JoyRideCache } from "../JoyRideCache"
import { createJoyRideBugReportSnapshot } from "../JoyRideDiagnostics"
import { createJoyRideTaskScope, lookupSafeCommandResult, lookupSearchResult } from "../JoyRideHotPath"
import { createCommandResultCacheKey, createJoyRideFingerprint } from "../keys"
import { type JoyRideSetMetadata } from "../types"

const MAX_INSERT_MS = 500
const MAX_LOOKUP_MS = 50
const MAX_STATS_MS = 20
const MAX_SNAPSHOT_MS = 100
const MAX_FLUSH_MS = 500

function createMetadata(taskId: string): JoyRideSetMetadata {
	return {
		cacheKind: "hotExecution",
		scope: { type: "task", id: taskId },
		ownerTaskId: taskId,
		ttlMs: 60_000,
		fingerprint: createJoyRideFingerprint({ bench: true }),
		workspaceFingerprint: createJoyRideFingerprint({ cwd: "/bench" }),
		approvalBoundaryId: "bench-boundary",
		invalidationReason: ["ttl_expired"],
		admissionReason: "benchmark entry",
		safetyClassification: "taskLocal",
		generation: 1,
	}
}

describe("JoyRide performance regression gates", function () {
	this.timeout(15_000)

	it("should stay within generous latency thresholds", async () => {
		const cache = new JoyRideCache({
			maxTotalBytes: 4 * 1024 * 1024,
			maxEntryBytes: 512 * 1024,
			maxPerTaskBytes: 1024 * 1024,
		})
		const metadata = createMetadata("bench-task")
		const keys = Array.from({ length: 200 }, (_, i) =>
			createCommandResultCacheKey({ command: `npm test --filter=${i}`, cwd: "/bench", environmentFingerprint: "env" }),
		)

		const insertStart = performance.now()
		for (const key of keys) {
			cache.set(key.key, { output: `result-${key.fingerprint.slice(0, 8)}` }, metadata)
		}
		const insertMs = performance.now() - insertStart

		const lookupStart = performance.now()
		for (const key of keys) {
			cache.get(key.key)
		}
		const lookupMs = performance.now() - lookupStart

		const statsStart = performance.now()
		cache.getStats()
		const statsMs = performance.now() - statsStart

		const snapshotStart = performance.now()
		createJoyRideBugReportSnapshot(cache)
		const snapshotMs = performance.now() - snapshotStart

		const flushStart = performance.now()
		cache.flushTask("bench-task")
		const flushMs = performance.now() - flushStart

		const scope = createJoyRideTaskScope("bench-decision", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		const decisionStart = performance.now()
		await lookupSafeCommandResult(cache, "pwd", scope)
		await lookupSearchResult(cache, "q", { cwd: process.cwd() }, scope)
		const decisionMs = performance.now() - decisionStart

		assert.isBelow(insertMs, MAX_INSERT_MS, `insert regression: ${insertMs.toFixed(1)}ms`)
		assert.isBelow(lookupMs, MAX_LOOKUP_MS, `lookup regression: ${lookupMs.toFixed(1)}ms`)
		assert.isBelow(statsMs, MAX_STATS_MS, `stats regression: ${statsMs.toFixed(1)}ms`)
		assert.isBelow(snapshotMs, MAX_SNAPSHOT_MS, `snapshot regression: ${snapshotMs.toFixed(1)}ms`)
		assert.isBelow(flushMs, MAX_FLUSH_MS, `flush regression: ${flushMs.toFixed(1)}ms`)
		assert.isBelow(decisionMs, MAX_LOOKUP_MS * 4, `decision regression: ${decisionMs.toFixed(1)}ms`)
	})
})
