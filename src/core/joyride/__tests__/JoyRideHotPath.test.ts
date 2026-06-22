/**
 * [LAYER: CORE]
 * JoyRide hot-path typed decision tests.
 */

import { assert } from "chai"
import { JoyRideCache } from "../JoyRideCache"
import { canCommandSkipExecution, isCommandCacheEligible, isVerificationCommand } from "../JoyRideCommandClassifier"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideTaskScope, lookupSafeCommandResult, storeReusableCommandResult } from "../JoyRideHotPath"

describe("JoyRideHotPath", () => {
	let cache: JoyRideCache

	beforeEach(() => {
		cache = new JoyRideCache({
			maxTotalBytes: 500_000,
			maxEntryBytes: 100_000,
			maxPerTaskBytes: 400_000,
			maxArtifactCount: 10,
			maxArtifactBytes: 50_000,
		})
	})

	describe("command classification", () => {
		it("should classify read-only commands as cache eligible", () => {
			assert.isTrue(canCommandSkipExecution("git status"))
			assert.isTrue(canCommandSkipExecution("ls -la"))
			assert.isTrue(isCommandCacheEligible("git log --oneline -5"))
		})

		it("should classify verification commands", () => {
			assert.isTrue(isVerificationCommand("npm test"))
			assert.isTrue(isVerificationCommand("npm run lint"))
			assert.isFalse(canCommandSkipExecution("npm test"))
		})

		it("should reject env-altering commands from read-only cache", () => {
			assert.isFalse(canCommandSkipExecution("npm install lodash"))
		})
	})

	describe("read-before-write command cache", () => {
		it("should return typed hit decision on second identical command", async () => {
			const scope = createJoyRideTaskScope("task-int-1", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			const command = "pwd"
			if (!canCommandSkipExecution(command)) {
				return
			}

			await storeReusableCommandResult(cache, command, [false, "/cached\n"], scope)
			const decision = await lookupSafeCommandResult(cache, command, scope)
			if (!isJoyRideHitDecision(decision)) {
				assert.fail("expected cache hit decision")
				return
			}
			assert.isFalse(decision.value[0])
			assert.include(String(decision.value[1]), "cached")
			assert.isDefined(decision.fallbackBehavior)
		})

		it("should not reuse diagnostic-only failed command output", async () => {
			const scope = createJoyRideTaskScope("task-int-2", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			const command = "git status"
			if (!isCommandCacheEligible(command)) {
				return
			}

			await storeReusableCommandResult(cache, command, [false, "Exit code: 1\nfailed"], scope)
			const decision = await lookupSafeCommandResult(cache, command, scope)
			assert.isFalse(decision.canReuse)
		})

		it("should reject late async write after task generation bump", async () => {
			const scope = createJoyRideTaskScope("task-int-3", process.cwd(), "vscodeTerminal", 1)
			cache.registerTask(scope.taskId, scope.generation)
			cache.bumpTaskGeneration(scope.taskId)
			const command = "pwd"
			if (!isCommandCacheEligible(command)) {
				return
			}

			await storeReusableCommandResult(cache, command, [false, "/tmp\n"], scope)
			const stats = cache.getStats()
			assert.isAbove(stats.lateWriteRejectionCount, 0)
		})
	})
})
