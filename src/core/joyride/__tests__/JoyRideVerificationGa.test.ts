/**
 * [LAYER: CORE]
 * Verification proof strictness — GA final pass.
 */

import { assert } from "chai"
import { lookupSafeCommandResult, storeReusableCommandResult } from "../JoyRideHotPath"
import { validateVerificationProof } from "../JoyRideVerification"
import { createVerificationCacheKey } from "../keys"
import { assertDecisionInvariants, createJoyRideTestCache, createTaskScope, expectNoActiveReuse } from "./JoyRideTestHelpers"

describe("JoyRide verification GA strictness", () => {
	it("should reject reuse when file hash proof is missing", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("verify-missing-hash")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "ok\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope, 0, {})
		assertDecisionInvariants(decision)
		expectNoActiveReuse(decision)
	})

	it("should reject reuse when approval boundary changes", async () => {
		const cache = createJoyRideTestCache()
		const scope1 = createTaskScope("verify-boundary", process.cwd(), 1)
		const scope2 = createTaskScope("verify-boundary", process.cwd(), 99)
		cache.registerTask(scope1.taskId, scope1.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "ok\n"], scope1)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope2, 0, { "src/a.ts": "h1" })
		expectNoActiveReuse(decision)
	})

	it("should require all validation fingerprint fields for complete proof", () => {
		const incomplete = validateVerificationProof({
			relevantFileHashes: { "src/a.ts": "h1" },
		})
		assert.isFalse(incomplete.valid)
		assert.include(incomplete.missing, "workspaceFingerprint")

		const partial = validateVerificationProof({
			relevantFileHashes: { "src/a.ts": "h1" },
			workspaceFingerprint: "ws",
			approvalBoundaryId: "ab",
			gitHead: "g",
			dependencyFingerprint: "d",
			lockfileFingerprint: "l",
			environmentFingerprint: "e",
			runtimeVersion: process.version,
			toolVersion: "lumi-verification-v1",
		})
		assert.isTrue(partial.valid)
	})

	it("should produce distinct keys when file hash changes", () => {
		const base = {
			command: "npm test",
			cwd: "/w",
			dependencyFingerprint: "d",
			lockfileFingerprint: "l",
			environmentFingerprint: "e",
			approvalBoundaryId: "ab",
			gitHead: "g",
			runtimeVersion: process.version,
			toolVersion: "lumi-verification-v1",
		}
		const k1 = createVerificationCacheKey({ ...base, relevantFileHashes: { "a.ts": "h1" } })
		const k2 = createVerificationCacheKey({ ...base, relevantFileHashes: { "a.ts": "h2" } })
		assert.notEqual(k1.key, k2.key)
	})

	it("should never reuse failed verification as truth", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("verify-failed")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "Exit code: 1\nfailed\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope, 0, { "src/a.ts": "h1" })
		expectNoActiveReuse(decision)
	})
})
