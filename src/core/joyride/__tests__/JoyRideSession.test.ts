/**
 * [LAYER: CORE]
 * Realistic LUMI agent session simulation for JoyRide release validation.
 */

import { assert } from "chai"
import { clearJoyRideCacheHitAuditTrail, getJoyRideCacheHitAuditTrail } from "../JoyRideAudit"
import { JoyRideCache } from "../JoyRideCache"
import { resetJoyRideConfig, setJoyRideConfig } from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { buildJoyRideDiagnosticReport } from "../JoyRideDiagnostics"
import {
	createJoyRideTaskScope,
	lookupSafeCommandResult,
	lookupSearchResult,
	storeReusableCommandResult,
	storeSearchResult,
} from "../JoyRideHotPath"
import { flushTaskGeneration, shutdownJoyRide } from "../JoyRideLifecycle"

describe("JoyRide session simulation", () => {
	const taskId = "session-task-1"
	const cwd = process.cwd()
	let cache: JoyRideCache
	let scope: ReturnType<typeof createJoyRideTaskScope>
	let fileGeneration = 0

	beforeEach(() => {
		resetJoyRideConfig()
		setJoyRideConfig({ mode: "enabled" })
		clearJoyRideCacheHitAuditTrail()
		cache = new JoyRideCache({ maxTotalBytes: 2 * 1024 * 1024, maxEntryBytes: 512 * 1024, maxPerTaskBytes: 1024 * 1024 })
		scope = createJoyRideTaskScope(taskId, cwd, "vscodeTerminal", 1)
		cache.registerTask(taskId, scope.generation)
		fileGeneration = 0
	})

	afterEach(() => {
		resetJoyRideConfig()
	})

	it("should simulate a normal agent coding loop with correct invalidation", async () => {
		const statusMiss = await lookupSafeCommandResult(cache, "git status", scope, fileGeneration)
		assert.isFalse(statusMiss.canReuse, "cold git status should miss")
		await storeReusableCommandResult(cache, "git status", [false, "clean\n"], scope, fileGeneration)
		const statusHit = await lookupSafeCommandResult(cache, "git status", scope, fileGeneration)
		assert.isTrue(isJoyRideHitDecision(statusHit), "warm git status should hit")

		const searchOpts = { cwd, includeGlobs: ["*.ts"] as string[] }
		await storeSearchResult(cache, "export function", searchOpts, "Found 5 results", 5, scope, fileGeneration)
		const searchHit1 = await lookupSearchResult(cache, "export function", searchOpts, scope, fileGeneration)
		if (!isJoyRideHitDecision(searchHit1)) {
			assert.fail("expected cache hit decision")
			return
		}
		assert.equal(searchHit1.value, "Found 5 results")

		await storeReusableCommandResult(cache, "npm test", [false, "all passed\n"], scope, fileGeneration)
		const verifyMiss = await lookupSafeCommandResult(cache, "npm test", scope, fileGeneration, {})
		assert.isFalse(verifyMiss.canReuse, "verification must not skip without file-hash proof")

		fileGeneration++

		const searchAfterChange = await lookupSearchResult(cache, "export function", searchOpts, scope, fileGeneration)
		assert.isFalse(searchAfterChange.canReuse, "search should miss after workspace generation change")

		const verifyAfterChange = await lookupSafeCommandResult(cache, "npm test", scope, fileGeneration, {
			"src/index.ts": "newhash",
		})
		assert.isFalse(verifyAfterChange.canReuse)

		await storeReusableCommandResult(cache, "npm install lodash", [false, "installed\n"], scope, fileGeneration)
		const unsafe = await lookupSafeCommandResult(cache, "npm install lodash", scope, fileGeneration)
		assert.isFalse(unsafe.canReuse)

		const trail = getJoyRideCacheHitAuditTrail()
		assert.isAtLeast(trail.length, 1)

		const flushed = flushTaskGeneration(cache, taskId, "task_completed")
		assert.isAbove(flushed, 0)
		assert.equal(cache.getStats().entryCount, 0)

		const shutdownCount = shutdownJoyRide(cache, "workspace_closed")
		assert.isAtLeast(shutdownCount, 0)

		const report = buildJoyRideDiagnosticReport(cache)
		assert.isAtLeast(report.summary.auditTrailCount, 1)
		assert.isAtLeast(report.stats.hitCount + report.stats.missCount, 1)
	})
})
