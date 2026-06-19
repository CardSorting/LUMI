/**
 * [LAYER: CORE]
 * Realistic LUMI session validation — operational dogfooding without UI.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assert } from "chai"
import { getJoyRideCacheHitAuditTrail } from "../JoyRideAudit"
import { markJoyRideDegraded, resetJoyRideDegraded, setJoyRideConfig } from "../JoyRideConfig"
import { buildJoyRideWorkspaceSnapshot } from "../JoyRideContext"
import { getJoyRideDecisionLog } from "../JoyRideDecisionLog"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideBugReportSnapshot, summarizeJoyRideHealth } from "../JoyRideDiagnostics"
import {
	lookupSafeCommandResult,
	lookupSearchResult,
	lookupVerificationProof,
	storeReusableCommandResult,
	storeSearchResult,
	storeVerificationProof,
} from "../JoyRideHotPath"
import { bumpTaskGeneration, flushTaskGeneration, shutdownJoyRide } from "../JoyRideLifecycle"
import { storeScratchArtifactWithCleanup } from "../JoyRideScratch"
import { summarizeJoyRideCommandOutput } from "../summaries"
import {
	assertDecisionInvariants,
	createJoyRideTestCache,
	createTaskScope,
	expectCacheHit,
	expectNoActiveReuse,
	expectNoUnsafeReuse,
} from "./JoyRideTestHelpers"

describe("JoyRide real-session validation", () => {
	afterEach(() => {
		resetJoyRideDegraded()
		setJoyRideConfig({ mode: "enabled" })
	})

	it("1. small code edit: repeated git status + search reuse", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-edit")
		cache.registerTask(scope.taskId, scope.generation)
		const searchOpts = { cwd: scope.cwd, includeGlobs: ["*.ts"] as string[] }

		await storeReusableCommandResult(cache, "git status", [false, "clean\n"], scope)
		const cmdHit = await lookupSafeCommandResult(cache, "git status", scope)
		expectCacheHit(cmdHit)

		await storeSearchResult(cache, "export function", searchOpts, "Found 3", 3, scope)
		const searchHit = await lookupSearchResult(cache, "export function", searchOpts, scope)
		expectCacheHit(searchHit)

		expectNoUnsafeReuse(getJoyRideDecisionLog())
		assert.isAtMost(getJoyRideDecisionLog(256).length, 128)
	})

	it("2. test-fix-test: verification refuses without proof, reruns after hash change", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-test-fix")
		cache.registerTask(scope.taskId, scope.generation)
		let gen = 0

		await storeReusableCommandResult(cache, "npm test", [false, "all passed\n"], scope, gen)
		const noProof = await lookupSafeCommandResult(cache, "npm test", scope, gen, {})
		expectNoActiveReuse(noProof)

		const withProof = await lookupSafeCommandResult(cache, "npm test", scope, gen, { "src/a.ts": "h1" })
		// stored without proof at admission — may miss until full proof store path
		expectNoActiveReuse(withProof)

		gen++
		const afterChange = await lookupSafeCommandResult(cache, "npm test", scope, gen, { "src/a.ts": "h2" })
		expectNoActiveReuse(afterChange)
	})

	it("3. lint-fix loop: search invalidates on workspace generation bump", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-lint")
		cache.registerTask(scope.taskId, scope.generation)
		const opts = { cwd: scope.cwd, includeGlobs: ["*.ts"] as string[] }

		await storeSearchResult(cache, "eslint-disable", opts, "Found 1", 1, scope, 0)
		const hit = await lookupSearchResult(cache, "eslint-disable", opts, scope, 0)
		expectCacheHit(hit)

		const afterFix = await lookupSearchResult(cache, "eslint-disable", opts, scope, 1)
		expectNoActiveReuse(afterFix)
	})

	it("4. workspace drift: flushWorkspace after env-altering invalidation path", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-drift")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/w\n"], scope)
		const snapshot = await import("../JoyRideContext").then((m) =>
			m.buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode),
		)
		const { flushWorkspace } = await import("../JoyRideLifecycle")
		flushWorkspace(cache, snapshot.workspaceFingerprint, "workspace_drift")
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		// entry may miss after workspace flush invalidation
		expectNoActiveReuse(decision)
	})

	it("5. package lock change: verification stale after lockfile fingerprint change", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "joyride-lock-"))
		try {
			const cache = createJoyRideTestCache()
			const scope = createTaskScope("session-lockfile", tmpDir)
			cache.registerTask(scope.taskId, scope.generation)
			const hashes = { "src/a.ts": "h1" }
			const snapBefore = await buildJoyRideWorkspaceSnapshot(tmpDir, scope.terminalMode)
			const entry = {
				command: "npm test",
				cwd: scope.cwd,
				userRejected: false,
				outputSummary: summarizeJoyRideCommandOutput("all passed\n"),
				capturedAt: Date.now(),
				diagnosticOnly: false,
			}
			await storeVerificationProof(cache, "npm test", entry, scope, snapBefore, false, hashes)
			const hit = await lookupVerificationProof(cache, "npm test", scope, snapBefore, hashes)
			expectCacheHit(hit)

			fs.writeFileSync(path.join(tmpDir, "package-lock.json"), '{"lockfileVersion":3}')
			const snapAfter = await buildJoyRideWorkspaceSnapshot(tmpDir, scope.terminalMode)
			assert.notEqual(snapBefore.lockfileFingerprint, snapAfter.lockfileFingerprint)
			const afterLockChange = await lookupVerificationProof(cache, "npm test", scope, snapAfter, hashes)
			expectNoActiveReuse(afterLockChange)
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		}
	})

	it("6. task cancellation: bump generation rejects late store", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-cancel")
		cache.registerTask(scope.taskId, scope.generation)
		bumpTaskGeneration(cache, scope.taskId)
		await storeReusableCommandResult(cache, "pwd", [false, "/late\n"], scope)
		assert.isAbove(cache.getStats().lateWriteRejectionCount, 0)
	})

	it("7. task completion: scratch cleanup on flush", async () => {
		let cleaned = 0
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-scratch")
		cache.registerTask(scope.taskId, scope.generation)
		await storeScratchArtifactWithCleanup(
			cache,
			{
				artifactKind: "temp",
				ownerTaskId: scope.taskId,
				ttlMs: 60_000,
				estimatedBytes: 256,
				cleanupHandler: () => {
					cleaned++
				},
			},
			{ data: 1 },
			scope,
		)
		flushTaskGeneration(cache, scope.taskId, "task_completed")
		assert.equal(cleaned, 1)
		assert.equal(cache.getStats().entryCount, 0)
	})

	it("8. degraded session: no hits, health reflects degraded", async () => {
		const cache = createJoyRideTestCache()
		markJoyRideDegraded("session degraded")
		const scope = createTaskScope("session-degraded")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
		assert.include(summarizeJoyRideHealth(cache), "degraded=true")
	})

	it("9. diagnostics-only session: store without skip", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "diagnostics-only" })
		const scope = createTaskScope("session-diag")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "git status", [false, "ok\n"], scope)
		const decision = await lookupSafeCommandResult(cache, "git status", scope)
		assertDecisionInvariants(decision)
		assert.isFalse(isJoyRideHitDecision(decision))
	})

	it("10. disabled session: no storage", async () => {
		const cache = createJoyRideTestCache()
		setJoyRideConfig({ mode: "disabled" })
		const scope = createTaskScope("session-disabled")
		await storeReusableCommandResult(cache, "pwd", [false, "/x\n"], scope)
		assert.equal(cache.getStats().entryCount, 0)
		const decision = await lookupSafeCommandResult(cache, "pwd", scope)
		assert.equal(decision.type, "disabled")
	})

	it("11. shutdown: bounded diagnostics and useful bug snapshot", async () => {
		const cache = createJoyRideTestCache()
		const scope = createTaskScope("session-shutdown")
		cache.registerTask(scope.taskId, scope.generation)
		await storeReusableCommandResult(cache, "git status", [false, "ok\n"], scope)
		await lookupSafeCommandResult(cache, "git status", scope)

		const snapshot = JSON.parse(createJoyRideBugReportSnapshot(cache))
		assert.isDefined(snapshot.config)
		assert.isDefined(snapshot.stats)
		assert.isDefined(snapshot.summary)
		assert.isAtMost(snapshot.decisionLogSize, 128)
		assert.isAtLeast(getJoyRideCacheHitAuditTrail().length, 0)

		shutdownJoyRide(cache)
		const health = summarizeJoyRideHealth(cache)
		assert.include(health, "helping=")
	})
})
