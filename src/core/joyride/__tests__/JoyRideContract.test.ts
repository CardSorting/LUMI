/**
 * [LAYER: CORE]
 * JoyRide trust contract — regression guards for release-candidate safety promises.
 */

import { assert } from "chai"
import { clearJoyRideCacheHitAuditTrail, getJoyRideCacheHitAuditTrail } from "../JoyRideAudit"
import { JoyRideCache } from "../JoyRideCache"
import { canCommandSkipExecution } from "../JoyRideCommandClassifier"
import {
	canJoyRideReuseCommands,
	canJoyRideReuseSearch,
	canJoyRideSkipWork,
	canJoyRideStore,
	resetJoyRideConfig,
	setJoyRideConfig,
} from "../JoyRideConfig"
import {
	createJoyRideTaskScope,
	lookupSafeCommandResult,
	lookupSearchResult,
	storeReusableCommandResult,
	storeSearchResult,
} from "../JoyRideHotPath"
import { createCommandResultCacheKey, createJoyRideFingerprint } from "../keys"

describe("JoyRide trust contract", () => {
	beforeEach(() => {
		resetJoyRideConfig()
		setJoyRideConfig({ mode: "enabled" })
		clearJoyRideCacheHitAuditTrail()
	})

	afterEach(() => {
		resetJoyRideConfig()
	})

	it("unknown commands never skip execution", () => {
		assert.isFalse(canCommandSkipExecution("./my-tool --scan"))
		assert.isFalse(canCommandSkipExecution("custom-agent-script"))
	})

	it("unsafe shell syntax never skips even when prefixed with safe command text", () => {
		assert.isFalse(canCommandSkipExecution('git status "| rm -rf /"'))
		assert.isFalse(canCommandSkipExecution("git status; rm -rf /"))
	})

	it("failed verification never becomes proof on lookup", async () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-1", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "Exit code: 1\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope, 0, { "src/a.ts": "h1" })
		assert.isFalse(decision.canReuse)
	})

	it("verification without full file-hash proof never skips", async () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-2", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "ok\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "npm test", scope, 0, {})
		assert.isFalse(decision.canReuse)
	})

	it("disabled mode never stores or reuses", async () => {
		setJoyRideConfig({ mode: "disabled" })
		assert.isFalse(canJoyRideStore())
		assert.isFalse(canJoyRideSkipWork())
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-3", process.cwd(), "vscodeTerminal", 1)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		assert.isFalse((await lookupSafeCommandResult(cache, "pwd", scope)).canReuse)
		assert.equal(cache.getStats().entryCount, 0)
	})

	it("diagnostics-only mode never skips", async () => {
		setJoyRideConfig({ mode: "diagnostics-only" })
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-4", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		assert.isFalse((await lookupSafeCommandResult(cache, "pwd", scope)).canReuse)
	})

	it("command-reuse-disabled mode never skips commands", async () => {
		setJoyRideConfig({ mode: "enabled", commandReuseDisabled: true })
		assert.isFalse(canJoyRideReuseCommands())
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-5", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		assert.isFalse((await lookupSafeCommandResult(cache, "pwd", scope)).canReuse)
	})

	it("search-cache-disabled mode never reuses search", async () => {
		setJoyRideConfig({ mode: "enabled", searchCacheDisabled: true })
		assert.isFalse(canJoyRideReuseSearch())
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-6", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		const opts = { cwd: process.cwd() }
		await storeSearchResult(cache, "pattern", opts, "results", 1, scope)
		assert.isFalse((await lookupSearchResult(cache, "pattern", opts, scope)).canReuse)
	})

	it("active cache skip always emits audit record", async () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-7", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/audited\n"], scope)
		await lookupSafeCommandResult(cache, "pwd", scope)
		const trail = getJoyRideCacheHitAuditTrail()
		assert.isAtLeast(trail.length, 1)
		assert.include(trail[trail.length - 1].reuseReason, "readonly")
	})

	it("explain reports diagnosticOnly accurately", async () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 100_000, maxPerTaskBytes: 400_000 })
		const scope = createJoyRideTaskScope("contract-8", process.cwd(), "vscodeTerminal", 1)
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "npm test", [false, "Exit code: 1\n"], scope)
		const keys = [...cache.getStats().largestEntries]
		if (keys.length > 0) {
			const explanation = cache.explain(keys[0].key)
			if (explanation.exists) {
				assert.isTrue(explanation.diagnosticOnly)
				assert.isFalse(explanation.canReuse)
			}
		}
	})

	it("stale diagnostic cap remains bounded under invalidation load", () => {
		const cache = new JoyRideCache({ maxTotalBytes: 500_000, maxEntryBytes: 10_000, maxPerTaskBytes: 400_000 })
		for (let i = 0; i < 400; i++) {
			const key = createCommandResultCacheKey({ command: `c${i}`, cwd: "/w", environmentFingerprint: "e" })
			cache.set(
				key.key,
				{ v: i },
				{
					cacheKind: "hotExecution",
					scope: { type: "task", id: "cap-task" },
					ownerTaskId: "cap-task",
					ttlMs: 60_000,
					fingerprint: key.fingerprint,
					workspaceFingerprint: createJoyRideFingerprint({ cwd: "/w" }),
					approvalBoundaryId: "b",
					invalidationReason: ["ttl_expired"],
					admissionReason: "cap test",
					safetyClassification: "taskLocal",
					generation: 1,
				},
			)
			cache.invalidate({ ownerTaskId: "cap-task", reason: "workspace_drift" })
		}
		assert.isAtMost(cache.getStats().staleDiagnosticCount, 256)
	})
})
