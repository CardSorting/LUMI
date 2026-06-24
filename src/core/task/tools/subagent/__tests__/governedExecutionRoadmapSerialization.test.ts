import { strict as assert } from "node:assert"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type { ClaimHistoryEntry, LaneExecutionReceipt } from "@shared/subagent/governedExecution"
import { afterEach, describe, it } from "mocha"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { swarmEnvelopeToReplayArtifact } from "../executionReplayMappers"
import { applyGovernedRoadmapCompletionPolicy } from "../GovernedIntegration"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { classifyLockNecessity, resolveLaneLockIntent } from "../LockNecessity"
import { runMergeGate } from "../MergeGate"
import { auditRoadmapCompletionIntegrity, auditStaleRoadmapOrchestrationLease, runRoadmapMergeAudit } from "../RoadmapMergeAudit"
import { buildRoadmapItemKey, buildRoadmapWorkspaceKey } from "../RoadmapMutation"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"

function buildAgent(agentId: string, index: number, overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(agentId, "exec-rm", "researcher", "swarm-rm", "task-rm", "roadmap work", {
		swarmId: "swarm-rm",
		index,
		depth: 1,
	})
	builder.setStatus("completed")
	builder.recordToolStep("read_file", "read_file(path=src/a.ts)", "ok", { path: "src/a.ts" })
	builder.setTranscriptMeta("subagent_executions/swarm-rm/a.transcript.jsonl", 1, 40)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [], ...overrides }
}

function laneBase(overrides: Record<string, unknown>): LaneExecutionReceipt {
	return {
		laneId: "l0",
		agentId: "a",
		index: 0,
		status: "completed",
		claimReleased: true,
		evidenceCount: 1,
		toolStepCount: 1,
		transcriptArtifactPath: "t.jsonl",
		sealedAt: Date.now(),
		touchedFiles: [],
		executionMode: "mutation",
		lockRequired: true,
		...overrides,
	} as LaneExecutionReceipt
}

function emptyEnvelope(agents: SubagentExecutionEnvelope[]) {
	return {
		swarmId: "swarm-rm",
		executionId: "exec-rm",
		taskId: "task-rm",
		continuity: {
			swarmId: "swarm-rm",
			taskId: "task-rm",
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
		artifactPath: "subagent_executions/swarm-rm.json",
		schemaVersion: 1 as const,
	}
}

function roadmapClaim(laneId: string, resourceKey: string, ownerId: string, claimId?: string): ClaimHistoryEntry {
	return {
		claimId: claimId ?? `${laneId}-${resourceKey}`,
		laneId,
		resourceKey,
		ownerId,
		fencingToken: 1,
		event: "acquired",
		timestamp: Date.now(),
	}
}

function sequentialRoadmapClaimHistory(
	lanes: Array<{ laneId: string; ownerId: string; claimId: string }>,
	resourceKey: string,
): ClaimHistoryEntry[] {
	const history: ClaimHistoryEntry[] = []
	let ts = Date.now()
	for (const lane of lanes) {
		history.push({
			claimId: lane.claimId,
			laneId: lane.laneId,
			resourceKey,
			ownerId: lane.ownerId,
			fencingToken: 1,
			event: "acquired",
			timestamp: ts++,
		})
		history.push({
			claimId: lane.claimId,
			laneId: lane.laneId,
			resourceKey,
			ownerId: lane.ownerId,
			fencingToken: 1,
			event: "released",
			timestamp: ts++,
		})
	}
	return history
}

describe("governed execution roadmap serialization", () => {
	afterEach(() => {
		InMemoryLockAuthority.reset()
	})

	describe("classifier", () => {
		it("completion update uses projection model without workspace lock", () => {
			const intent = resolveLaneLockIntent("[execution_mode:read_only] [mutates_roadmap_completion]", {}, 0)
			const result = classifyLockNecessity(intent)
			assert.equal(result.roadmapMutationLockRequired, false)
			assert.equal(result.lockRequired, false)
		})

		it("advisory-only completion signal without write set does not require roadmap lock alone", () => {
			const intent = resolveLaneLockIntent("[execution_mode:read_only] [roadmap_read_set:workspace]", {}, 0)
			const result = classifyLockNecessity(intent)
			assert.equal(result.roadmapMutationLockRequired, false)
			assert.equal(result.lockRequired, false)
		})
	})

	describe("merge gate", () => {
		it("two lanes reading same roadmap item pass", () => {
			const item = buildRoadmapItemKey("TASK-1")
			const gate = runMergeGate({
				agents: [buildAgent("a", 0), buildAgent("b", 1)],
				laneReceipts: [
					laneBase({
						laneId: "l0",
						agentId: "a",
						index: 0,
						executionMode: "read_only",
						lockRequired: false,
						roadmapReadSet: [item],
					}),
					laneBase({
						laneId: "l1",
						agentId: "b",
						index: 1,
						executionMode: "read_only",
						lockRequired: false,
						roadmapReadSet: [item],
					}),
				],
				claimHistory: [],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(emptyEnvelope([buildAgent("a", 0), buildAgent("b", 1)])),
			})
			assert.equal(gate.passed, true)
			assert.equal(gate.roadmapAudit?.violations.length, 0)
		})

		it("two lanes writing same roadmap item collide", () => {
			const item = buildRoadmapItemKey("TASK-1")
			const gate = runMergeGate({
				agents: [buildAgent("a", 0), buildAgent("b", 1)],
				laneReceipts: [
					laneBase({
						laneId: "l0",
						agentId: "a",
						index: 0,
						claimId: "claim-l0",
						roadmapWriteSet: [item],
						roadmapMutationLockRequired: true,
						roadmapMutationClaimReleased: true,
					}),
					laneBase({
						laneId: "l1",
						agentId: "b",
						index: 1,
						claimId: "claim-l1",
						roadmapWriteSet: [item],
						roadmapMutationLockRequired: true,
						roadmapMutationClaimReleased: true,
					}),
				],
				claimHistory: [roadmapClaim("l0", item, "a"), roadmapClaim("l1", item, "b")],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(emptyEnvelope([buildAgent("a", 0), buildAgent("b", 1)])),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("roadmap mutation overlap")))
		})

		it("dependency-ordered roadmap writes pass", () => {
			const item = buildRoadmapItemKey("TASK-1")
			const gate = runMergeGate({
				agents: [buildAgent("a", 0), buildAgent("b", 1)],
				laneReceipts: [
					laneBase({
						laneId: "l0",
						agentId: "a",
						index: 0,
						claimId: "claim-l0",
						roadmapWriteSet: [item],
						roadmapMutationLockRequired: true,
						roadmapMutationClaimReleased: true,
					}),
					laneBase({
						laneId: "l1",
						agentId: "b",
						index: 1,
						claimId: "claim-l1",
						roadmapWriteSet: [item],
						roadmapMutationLockRequired: true,
						roadmapMutationClaimReleased: true,
					}),
				],
				claimHistory: sequentialRoadmapClaimHistory(
					[
						{ laneId: "l0", ownerId: "a", claimId: "rm-0" },
						{ laneId: "l1", ownerId: "b", claimId: "rm-1" },
					],
					item,
				),
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [0], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(emptyEnvelope([buildAgent("a", 0), buildAgent("b", 1)])),
			})
			assert.equal(gate.passed, true, gate.violations.join("; "))
		})

		it("lock-skipped lane mutating roadmap fails", () => {
			const gate = runMergeGate({
				agents: [
					buildAgent("a", 0, {
						toolSteps: [{ toolName: "roadmap", params: { action: "update" }, rawInput: "", resultSummary: "" }],
					}),
				],
				laneReceipts: [
					laneBase({
						laneId: "l0",
						agentId: "a",
						index: 0,
						executionMode: "read_only",
						lockRequired: false,
						roadmapMutationLockRequired: false,
						roadmapWriteSet: [buildRoadmapWorkspaceKey()],
					}),
				],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(emptyEnvelope([buildAgent("a", 0)])),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("lock-skipped lane")))
		})

		it("roadmap mutation without claim fails merge gate", () => {
			const gate = runMergeGate({
				agents: [buildAgent("a", 0)],
				laneReceipts: [
					laneBase({
						laneId: "l0",
						agentId: "a",
						roadmapWriteSet: [buildRoadmapWorkspaceKey()],
						roadmapMutationLockRequired: true,
						roadmapMutationClaimReleased: true,
					}),
				],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(emptyEnvelope([buildAgent("a", 0)])),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("without roadmap mutation claim")))
		})

		it("stale roadmap lease blocks unsafe merge", () => {
			const audit = runRoadmapMergeAudit({
				laneReceipts: [],
				laneDag: [],
				claimHistory: [],
				agents: [],
				roadmapLinkage: {
					roadmapEnabled: true,
					orchestrationLeaseTaskIds: ["lease-1"],
					laneRoadmapItems: [],
					orchestrationLease: {
						acquired: true,
						taskId: "lease-1",
						ownerId: "parent",
						unreleasedRisk: true,
					},
				},
				mergePassed: true,
				sealed: true,
			})
			assert.equal(audit.safe, false)
			assert.ok(audit.violations.some((v) => v.includes("stale roadmap orchestration lease")))
		})
	})

	describe("completion policy", () => {
		it("advisory-only completion does not mutate roadmap", async () => {
			const outcome = await applyGovernedRoadmapCompletionPolicy({
				workspace: "/tmp",
				policy: "advisory_only",
				sealed: true,
				mergePassed: true,
				integrityValid: true,
			})
			assert.equal(outcome.status, "advisory_only")
			const violations = auditRoadmapCompletionIntegrity(
				{
					roadmapEnabled: true,
					orchestrationLeaseTaskIds: [],
					laneRoadmapItems: [],
					completionOutcome: outcome,
				},
				true,
				true,
			)
			assert.equal(violations.length, 0)
		})

		it("completion update after failed merge is rejected", () => {
			const violations = auditRoadmapCompletionIntegrity(
				{
					roadmapEnabled: true,
					orchestrationLeaseTaskIds: [],
					laneRoadmapItems: [],
					completionOutcome: {
						policy: "update_on_sealed_success",
						status: "updated",
						reason: "roadmap_completion_applied",
					},
				},
				false,
				false,
			)
			assert.ok(violations.some((v) => v.includes("after failed merge")))
		})
	})

	describe("acquireLane", () => {
		it("parallel agent roadmap projections do not require workspace locks", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", true, 2, undefined, new InMemoryLockAuthority())
			await coordinator.admitSwarm("parent")
			const first = await coordinator.acquireLane("swarm-rm", "agent-a", 0, {
				executionMode: "read_only",
				roadmapMutationSignals: ["mutate_now"],
				mutatesRoadmap: true,
			})
			const second = await coordinator.acquireLane("swarm-rm", "agent-b", 1, {
				executionMode: "read_only",
				roadmapMutationSignals: ["mutate_now"],
				mutatesRoadmap: true,
			})
			assert.equal(first.success, true)
			assert.equal(second.success, true)
			assert.ok(first.claim?.agentRoadmap)
			assert.ok(second.claim?.agentRoadmap)
		})

		it("parallel roadmap reads skip mutation locks", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", false, 2, undefined, new InMemoryLockAuthority())
			const item = buildRoadmapItemKey("TASK-9")
			const a = await coordinator.acquireLane("swarm-rm", "agent-a", 0, {
				executionMode: "read_only",
				roadmapReadSet: [item],
			})
			const b = await coordinator.acquireLane("swarm-rm", "agent-b", 1, {
				executionMode: "read_only",
				roadmapReadSet: [item],
			})
			assert.equal(a.success, true)
			assert.equal(b.success, true)
			assert.equal(a.lockSkipped, true)
			assert.equal(b.lockSkipped, true)
			assert.equal(a.claim?.roadmapLockClaims?.length ?? 0, 0)
		})
	})

	describe("stale lease audit helper", () => {
		it("flags unreleased orchestration lease", () => {
			const violations = auditStaleRoadmapOrchestrationLease({
				roadmapEnabled: true,
				orchestrationLeaseTaskIds: ["x"],
				laneRoadmapItems: [],
				orchestrationLease: { acquired: true, taskId: "x", ownerId: "p", unreleasedRisk: true },
			})
			assert.equal(violations.length, 1)
		})
	})
})
