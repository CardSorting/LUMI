/**
 * [LAYER: CORE]
 * JoyRide diagnostic report tests.
 */

import { assert } from "chai"
import { JoyRideCache } from "../JoyRideCache"
import { resetJoyRideConfig, setJoyRideConfig } from "../JoyRideConfig"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { buildJoyRideDiagnosticReport, formatJoyRideDiagnosticReport } from "../JoyRideDiagnostics"
import { createJoyRideTaskScope, lookupSafeCommandResult, storeReusableCommandResult } from "../JoyRideHotPath"

describe("JoyRideDiagnostics", () => {
	beforeEach(() => {
		resetJoyRideConfig()
		setJoyRideConfig({ mode: "enabled" })
	})

	afterEach(() => {
		resetJoyRideConfig()
	})

	it("should answer maintainer questions in structured report", async () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("diag-task", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assert.isTrue(isJoyRideHitDecision(decision))

		const report = buildJoyRideDiagnosticReport(cache)
		const formatted = formatJoyRideDiagnosticReport(report)

		assert.equal(report.config.mode, "enabled")
		assert.isAtLeast(report.summary.activeReuseCount, 1)
		assert.isAtLeast(report.summary.auditTrailCount, 1)
		assert.isAtLeast(report.recentDecisions.length, 1)
		assert.include(formatted, "JoyRide Diagnostic Report")
		assert.include(formatted, "commandReuse=true")
		assert.include(formatted, "recent_skips")
	})
})
