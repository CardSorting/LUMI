import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	GovernedSwarmReceipt,
	LaneDAGNode,
	LaneExecutionReceipt,
} from "@shared/subagent/governedExecution"
import { buildResourceOwners, isRetrySafe } from "@shared/subagent/governedExecution"
import { swarmEnvelopeToReplayArtifact } from "./executionReplayMappers"
import { validateGovernedReceipt } from "./GovernedExecutionStore"
import { type MergeGateInput, runMergeGate } from "./MergeGate"

export interface GateAuditCheck {
	name: string
	category: "false_positive" | "false_negative"
	passed: boolean
	detail?: string
}

export interface GovernedGateAuditReport {
	passed: boolean
	checks: GateAuditCheck[]
}

function check(name: string, category: GateAuditCheck["category"], passed: boolean, detail?: string): GateAuditCheck {
	return { name, category, passed, detail }
}

/** Regression audit — proves gate does not over-block or under-block known cases. */
export function auditGovernedGateBehavior(): GovernedGateAuditReport {
	const checks: GateAuditCheck[] = []

	const agentA = minimalAgent("a", 0)
	const agentB = minimalAgent("b", 1)
	const envelopeOverlap = minimalEnvelope([
		{ ...agentA, touchedFiles: ["src/shared.ts"] },
		{ ...agentB, touchedFiles: ["src/shared.ts"] },
	])
	const dagOrdered: LaneDAGNode[] = [
		{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
		{ index: 1, laneId: "l1", dependsOn: [0], state: "sealed" },
	]
	const overlapGate = runMergeGate({
		agents: [
			{ ...agentA, touchedFiles: ["src/shared.ts"] },
			{ ...agentB, touchedFiles: ["src/shared.ts"] },
		],
		laneReceipts: [completedLane("l0", "a", 0), completedLane("l1", "b", 1)],
		claimHistory: [],
		laneDag: dagOrdered,
		replayArtifact: swarmEnvelopeToReplayArtifact(envelopeOverlap),
	})
	checks.push(
		check(
			"dependency-ordered overlap allowed",
			"false_positive",
			!overlapGate.violations.some((v) => v.includes("unsafe overlap")),
		),
	)

	const claimId = "claim-uuid-1"
	const acquireReleaseHistory: ClaimHistoryEntry[] = [
		{ claimId, laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "acquired", timestamp: 1 },
		{ claimId, laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "released", timestamp: 2 },
	]
	const dupGate = runMergeGate(minimalGateInput([agentA], [completedLane("l0", "a", 0)], acquireReleaseHistory))
	checks.push(
		check(
			"acquired+released same claimId not duplicate",
			"false_positive",
			!dupGate.violations.some((v) => v.includes("duplicate claimId")),
		),
	)

	const skippedGate = runMergeGate({
		...minimalGateInput(
			[agentA],
			[
				{
					...completedLane("l0", "a", 0),
					status: "skipped",
					evidenceCount: 0,
					toolStepCount: 0,
					transcriptArtifactPath: undefined,
				},
			],
		),
		claimHistory: [],
		laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
	})
	checks.push(
		check(
			"skipped no-op lane not blocked for missing evidence",
			"false_positive",
			!skippedGate.violations.some((v) => v.includes("missing evidence") || v.includes("missing transcript")),
		),
	)

	const recoveredHistory: ClaimHistoryEntry[] = [
		{ laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "stale_detected", timestamp: 1 },
		{ laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "recovered", timestamp: 2 },
		{ laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "released", timestamp: 3 },
	]
	const owners = buildResourceOwners(recoveredHistory)
	checks.push(
		check(
			"stale recovered then released not active",
			"false_positive",
			!owners.some((o) => o.status === "active"),
			owners.map((o) => `${o.resourceKey}:${o.status}`).join(", "),
		),
	)

	const partialReceipt = minimalReceipt({ sealed: false, laneReceipts: [], claimHistory: acquireReleaseHistory })
	const retry = isRetrySafe(partialReceipt)
	checks.push(check("partial receipt with no active claims is retry-safe", "false_positive", retry.safe, retry.reason))

	const crashGate = runMergeGate({
		...minimalGateInput([], []),
		claimHistory: [{ laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "acquired", timestamp: 1 }],
		laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "running" }],
	})
	checks.push(check("crash after claim blocks merge", "false_negative", !crashGate.passed && crashGate.violations.length > 0))

	const failedMarkedSuccess = runMergeGate({
		agents: [{ ...agentA, status: "completed" }],
		laneReceipts: [{ ...completedLane("l0", "a", 0), status: "failed" }],
		claimHistory: [],
		laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "failed" }],
		replayArtifact: swarmEnvelopeToReplayArtifact(minimalEnvelope([{ ...agentA, status: "completed" }])),
	})
	checks.push(
		check(
			"failed lane marked successful blocks merge",
			"false_negative",
			failedMarkedSuccess.violations.some((v) => v.includes("failed lane marked successful")),
		),
	)

	const splitBrainGate = runMergeGate({
		...minimalGateInput([agentA], [completedLane("l0", "a", 0)]),
		claimHistory: [
			{ laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "acquired", timestamp: 1 },
			{ laneId: "l0", resourceKey: "k", ownerId: "b", fencingToken: 2, event: "acquired", timestamp: 2 },
		],
	})
	checks.push(check("split-brain blocks merge", "false_negative", splitBrainGate.splitBrainDetected))

	const corrupted = validateGovernedReceipt({ schemaVersion: 1 })
	checks.push(check("corrupted receipt fails validation", "false_negative", corrupted.corrupted && !corrupted.valid))

	const replayMismatchGate = runMergeGate({
		...minimalGateInput([agentA], [completedLane("l0", "a", 0)]),
		claimHistory: [],
		storedReplayChecksum: "0".repeat(64),
	})
	checks.push(check("replay checksum mismatch blocks merge", "false_negative", !replayMismatchGate.passed))

	return {
		passed: checks.every((c) => c.passed),
		checks,
	}
}

function minimalAgent(agentId: string, index: number, overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	return {
		agentId,
		executionId: `exec-${agentId}`,
		role: "researcher",
		prompt: "p",
		lineage: { swarmId: "swarm-1", index, depth: 1 },
		status: "completed",
		phase: "completed",
		evidenceRefs: [{ id: "e1", kind: "tool_output", label: "read", pointer: "p" }],
		touchedFiles: [],
		toolSteps: [{ toolName: "read_file", invocation: "read", resultSummary: "ok", params: {} }],
		compactionEvents: [],
		timestamps: { spawned: 1, completed: 2 },
		transcriptArtifactPath: `agents/${agentId}.jsonl`,
		...overrides,
	} as SubagentExecutionEnvelope
}

function minimalEnvelope(agents: SubagentExecutionEnvelope[]) {
	return {
		swarmId: "swarm-1",
		executionId: "exec-1",
		taskId: "task-1",
		continuity: {
			swarmId: "swarm-1",
			taskId: "task-1",
			resumeToken: "t",
			lastPersistedAt: Date.now(),
			completedAgents: agents.length,
			totalAgents: agents.length,
			status: "completed" as const,
		},
		agents,
		blackboardSnapshot: [],
		timestamps: { started: Date.now(), completed: Date.now() },
		status: "completed" as const,
		invariants: { validated: false, violations: [] },
		artifactPath: "subagent_executions/swarm-1.json",
		schemaVersion: 1 as const,
	}
}

function completedLane(laneId: string, agentId: string, index: number): LaneExecutionReceipt {
	return {
		laneId,
		agentId,
		index,
		status: "completed",
		claimReleased: true,
		evidenceCount: 1,
		touchedFiles: [],
		transcriptArtifactPath: `agents/${agentId}.jsonl`,
		toolStepCount: 1,
		sealedAt: Date.now(),
	}
}

function minimalGateInput(
	agents: SubagentExecutionEnvelope[],
	laneReceipts: LaneExecutionReceipt[],
	claimHistory: ClaimHistoryEntry[] = [],
): MergeGateInput {
	return {
		agents,
		laneReceipts,
		claimHistory,
		laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
		replayArtifact: swarmEnvelopeToReplayArtifact(minimalEnvelope(agents.length ? agents : [minimalAgent("a", 0)])),
	}
}

function minimalReceipt(overrides: Partial<GovernedSwarmReceipt>): GovernedSwarmReceipt {
	return {
		schemaVersion: 3,
		swarmId: "swarm-1",
		executionId: "exec-1",
		taskId: "task-1",
		attemptId: "attempt-1",
		admission: { admitted: true, backoffMs: 0 },
		laneReceipts: [],
		laneDag: [],
		claimHistory: [],
		mergeGate: {
			passed: false,
			mergeAudit: { safe: false, violations: [], overlappingPaths: [], missingEvidence: [], placeholderWarnings: [] },
			replayIntegrity: { valid: true, violations: [], checksum: "" },
			violations: [],
			failedLaneCount: 0,
			orphanedClaimCount: 0,
			staleLeaseCount: 0,
			splitBrainDetected: false,
			sealedSupersessionBlocked: false,
		},
		replayArtifactPath: "",
		governedArtifactPath: "",
		sealedAt: 0,
		sealed: false,
		integrity: { valid: false, violations: [], checksum: "" },
		...overrides,
	}
}
