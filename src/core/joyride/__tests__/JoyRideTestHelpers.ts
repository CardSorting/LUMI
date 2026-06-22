/**
 * [LAYER: CORE]
 * JoyRide test helpers — assert cache behavior without brittle setup.
 */

import { assert } from "chai"
import { clearJoyRideCacheHitAuditTrail } from "../JoyRideAudit"
import { JoyRideCache } from "../JoyRideCache"
import { resetJoyRideForTest, setJoyRideConfig } from "../JoyRideConfig"
import { buildJoyRideWorkspaceSnapshot } from "../JoyRideContext"
import { JOYRIDE_DECISION_REQUIRED_FIELDS } from "../JoyRideContract"
import { clearJoyRideDecisionLog, getJoyRideDecisionLog } from "../JoyRideDecisionLog"
import type { JoyRideCacheDecision } from "../JoyRideDecisions"
import { isJoyRideHitDecision } from "../JoyRideDecisions"
import { createJoyRideTaskScope } from "../JoyRideHotPath"
import type { JoyRideReasonCode } from "../JoyRideReasonCodes"

export function createJoyRideTestCache(overrides?: ConstructorParameters<typeof JoyRideCache>[0]): JoyRideCache {
	resetJoyRideForTest()
	setJoyRideConfig({ mode: "enabled" })
	clearJoyRideCacheHitAuditTrail()
	clearJoyRideDecisionLog()
	return new JoyRideCache(
		overrides ?? { maxTotalBytes: 2 * 1024 * 1024, maxEntryBytes: 512 * 1024, maxPerTaskBytes: 1024 * 1024 },
	)
}

export function createTaskScope(taskId = "test-task", cwd = process.cwd(), generation = 1) {
	return createJoyRideTaskScope(taskId, cwd, "vscodeTerminal", generation)
}

export async function createWorkspaceSnapshot(cwd = process.cwd(), changedFileGeneration = 0) {
	return buildJoyRideWorkspaceSnapshot(cwd, "vscodeTerminal", changedFileGeneration)
}

export function createVerificationProof(fileHashes: Record<string, string>): Record<string, string> {
	return { ...fileHashes }
}

export function expectCacheHit(decision: JoyRideCacheDecision): void {
	assert.equal(decision.type, "hit", `expected hit, got ${decision.type} (${decision.reasonCode})`)
	assert.isTrue(decision.canReuse, `expected canReuse=true (${decision.reasonCode})`)
	assert.isDefined(decision.fallbackBehavior)
}

export function expectCacheMiss(decision: JoyRideCacheDecision, reasonCode?: JoyRideReasonCode): void {
	assert.oneOf(decision.type, ["miss", "disabled", "stale", "degraded"], `expected miss-like decision, got ${decision.type}`)
	assert.isFalse(decision.canReuse)
	assert.isDefined(decision.fallbackBehavior)
	if (reasonCode) {
		assert.equal(decision.reasonCode, reasonCode, `expected reason ${reasonCode}, got ${decision.reasonCode}`)
	}
}

export function expectNoActiveReuse(decision: JoyRideCacheDecision): void {
	assert.isFalse(decision.canReuse, `expected no reuse (${decision.reasonCode})`)
}

export function expectDecisionReason(decision: JoyRideCacheDecision, reasonCode: JoyRideReasonCode): void {
	assert.equal(decision.reasonCode, reasonCode, `expected ${reasonCode}, got ${decision.reasonCode}`)
}

export function expectDiagnosticOnly(decision: JoyRideCacheDecision): void {
	assert.isTrue(decision.type === "diagnosticOnly" || decision.diagnosticOnly, "expected diagnostic-only")
	assert.isFalse(decision.canReuse)
}

export function expectRejected(decision: JoyRideCacheDecision): void {
	assert.equal(decision.type, "rejected")
	assert.isFalse(decision.canReuse)
}

export function expectStale(decision: JoyRideCacheDecision): void {
	assert.equal(decision.type, "stale")
	assert.isFalse(decision.canReuse)
}

export function expectFlushRemovesTaskEntries(cache: JoyRideCache, taskId: string): void {
	const before = cache.getStats().entryCount
	const flushed = cache.flushTask(taskId, "task_completed")
	assert.isAbove(flushed, 0, "expected entries flushed")
	assert.equal(cache.getStats().entryCount, before - flushed)
}

export function expectNoLateWrites(cache: JoyRideCache): void {
	assert.equal(cache.getStats().lateWriteRejectionCount, 0, "unexpected late writes")
}

export function expectNoUnsafeReuse(decisions: readonly JoyRideCacheDecision[]): void {
	for (const d of decisions) {
		if (d.canReuse) {
			assert.notEqual(d.reasonCode, "miss.command.unknown")
			assert.notEqual(d.reasonCode, "miss.command.unsafeSyntax")
		}
	}
}

export function assertDecisionInvariants(decision: JoyRideCacheDecision): void {
	for (const field of JOYRIDE_DECISION_REQUIRED_FIELDS) {
		assert.isDefined((decision as unknown as Record<string, unknown>)[field], `decision missing required field: ${field}`)
	}
	assert.isString(decision.reasonCode)
	assert.isNotEmpty(decision.reasonCode)
	assert.isString(decision.fallbackBehavior)
	assert.isNotEmpty(decision.fallbackBehavior)

	if (decision.canReuse) {
		assert.equal(decision.type, "hit")
		assert.isDefined((decision as { value?: unknown }).value)
	} else {
		assert.isUndefined((decision as { value?: unknown }).value)
	}

	if (decision.type === "disabled" || decision.type === "degraded" || decision.type === "diagnosticOnly") {
		assert.isFalse(isJoyRideHitDecision(decision))
	}
}

export function getRecordedDecisions(limit = 32): readonly JoyRideCacheDecision[] {
	return getJoyRideDecisionLog(limit)
}
