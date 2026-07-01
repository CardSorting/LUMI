import { strict as assert } from "node:assert"
import type { GovernedSwarmReceipt } from "@shared/subagent/governedExecution"
import { GOVERNED_RECEIPT_SCHEMA_VERSION } from "@shared/subagent/governedExecution"
import { describe, it } from "mocha"
import {
	classifyPreflightIssuesForSeal,
	evaluateCoordinatorHaltDecision,
	GovernanceParalysisTracker,
	mergeGovernanceDiagnostics,
	resolveContinuationFromParentSignals,
	resolvePriorSealedReceiptForMerge,
} from "../CoordinatorExecutionAuthority"

function sealedReceipt(attemptId: string): GovernedSwarmReceipt {
	return {
		schemaVersion: GOVERNED_RECEIPT_SCHEMA_VERSION,
		swarmId: "swarm-1",
		executionId: "exec-1",
		taskId: "task-1",
		attemptId,
		admission: { admitted: true, backoffMs: 0 },
		laneReceipts: [],
		laneDag: [],
		claimHistory: [],
		mergeGate: {
			passed: true,
			violations: [],
			sealedSupersessionBlocked: false,
			failedLaneCount: 0,
			mergeAudit: {
				safe: true,
				violations: [],
				overlappingPaths: [],
				missingEvidence: [],
				placeholderWarnings: [],
			},
			replayIntegrity: { valid: true, violations: [], checksum: "abc" },
			staleLeaseCount: 0,
			orphanedClaimCount: 0,
			splitBrainDetected: false,
		},
		replayArtifactPath: "subagent_executions/swarm-1.json",
		governedArtifactPath: `subagent_executions/swarm-1.governed.${attemptId}.json`,
		sealedAt: Date.now(),
		sealed: true,
		integrity: { valid: true, violations: [], checksum: "abc" },
	}
}

describe("CoordinatorExecutionAuthority", () => {
	it("prefers authoritative sealed receipt over stale latest pointer", () => {
		const authoritative = sealedReceipt("attempt-a")
		const latest = {
			...sealedReceipt("attempt-b"),
			sealed: false,
			mergeGate: { ...sealedReceipt("attempt-b").mergeGate, passed: false },
		}
		const { prior, diagnostics } = resolvePriorSealedReceiptForMerge(authoritative, latest)
		assert.equal(prior?.attemptId, "attempt-a")
		assert.ok(diagnostics.some((d) => d.code === "stale_receipt_authority_detected"))
	})

	it("downgrades advisory preflight halt decisions", () => {
		const decision = evaluateCoordinatorHaltDecision({
			proposedReason: "preflight advisory cooldown",
			source: "audit_preflight",
			context: { taskId: "task-1" },
		})
		assert.equal(decision.shouldHalt, false)
		assert.equal(decision.receiptDerivedOnly, true)
	})

	it("classifies seal preflight issues as advisory", () => {
		const { advisory, diagnostics } = classifyPreflightIssuesForSeal([
			{ stage: "min_length", message: "too brief", severity: "warning" },
		])
		assert.equal(advisory[0]?.severity, "info")
		assert.ok(diagnostics.some((d) => d.code === "duplicate_audit_path_detected"))
	})

	it("detects governance paralysis without workspace progress", () => {
		const tracker = new GovernanceParalysisTracker()
		const fp = "deadbeef"
		tracker.record("completion_gate:audit_gate", fp)
		tracker.record("completion_gate:audit_gate", fp)
		const events = tracker.record("completion_gate:audit_gate", fp)
		assert.ok(events.some((e) => e.code === "no_progress_execution_loop"))
	})

	it("continues lanes when parent gate signals are advisory only", () => {
		const result = resolveContinuationFromParentSignals([
			"ADVISORY: GATE: PARENT_BLOCKED (2)",
			"ADVISORY: SIGNAL: PARENT_GATE_BLOCKED",
		])
		assert.equal(result.shouldContinue, true)
		assert.equal(result.advisorySignals.length, 2)
	})

	it("collapses duplicate governance diagnostics", () => {
		const at = Date.now()
		const merged = mergeGovernanceDiagnostics(
			[{ code: "governance_recursion_detected", message: "same path", at }],
			[{ code: "governance_recursion_detected", message: "same path", at }],
		)
		assert.equal(merged.length, 1)
	})
})
