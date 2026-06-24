import { strict as assert } from "node:assert"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type { LaneExecutionReceipt } from "@shared/subagent/governedExecution"
import { describe, it } from "mocha"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { swarmEnvelopeToReplayArtifact } from "../executionReplayMappers"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { classifyLockNecessity, resolveLaneLockIntent } from "../LockNecessity"
import { runMergeGate } from "../MergeGate"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"

function buildAgent(agentId: string, index: number, overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(agentId, "exec-1", "researcher", "swarm-1", "task-1", "inspect module", {
		swarmId: "swarm-1",
		index,
		depth: 1,
	})
	builder.setStatus("completed")
	builder.recordToolStep("read_file", "read_file(path=src/shared.ts)", "contents", { path: "src/shared.ts" })
	builder.setTranscriptMeta("subagent_executions/swarm-1/agents/a.transcript.jsonl", 2, 80)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [], ...overrides }
}

function mutationLane(overrides: Partial<LaneExecutionReceipt>): LaneExecutionReceipt {
	return {
		laneId: "l0",
		agentId: "a",
		index: 0,
		status: "completed",
		executionMode: "mutation",
		lockRequired: true,
		claimReleased: true,
		evidenceCount: 1,
		toolStepCount: 1,
		transcriptArtifactPath: "t.jsonl",
		sealedAt: Date.now(),
		touchedFiles: [],
		...overrides,
	}
}

function readOnlyLane(overrides: Partial<LaneExecutionReceipt>): LaneExecutionReceipt {
	return {
		laneId: "l0",
		agentId: "a",
		index: 0,
		status: "completed",
		executionMode: "read_only",
		lockRequired: false,
		claimReleased: true,
		reasonLockSkipped: "read_only lane",
		evidenceCount: 1,
		toolStepCount: 1,
		transcriptArtifactPath: "t.jsonl",
		sealedAt: Date.now(),
		touchedFiles: [],
		...overrides,
	}
}

describe("governed execution lock necessity", () => {
	describe("classifier", () => {
		it("read-only parallel lanes reading same file do not require locks", () => {
			const intent = resolveLaneLockIntent("[execution_mode:read_only] Review src/shared.ts", {}, 0)
			const result = classifyLockNecessity(intent)
			assert.equal(result.lockRequired, false)
			assert.ok(result.reasonLockSkipped)
		})

		it("documentation lane with write_set requires lock", () => {
			const intent = resolveLaneLockIntent("[execution_mode:documentation_only] [write_set:docs/guide.md]", {}, 0)
			const result = classifyLockNecessity(intent)
			assert.equal(result.lockRequired, true)
			assert.ok(result.reasonLockAcquired?.includes("escalated"))
		})

		it("authoritative receipt pointer update requires lock in audit mode", () => {
			const intent = resolveLaneLockIntent("[execution_mode:audit_only] [updates_authoritative_receipt]", {}, 0)
			assert.equal(classifyLockNecessity(intent).lockRequired, true)
		})

		it("mutation mode always requires lock", () => {
			assert.equal(classifyLockNecessity({ executionMode: "mutation" }).lockRequired, true)
		})
	})

	describe("acquireLane", () => {
		it("skips lock for read-only lanes", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", false, 2, undefined, new InMemoryLockAuthority())
			const a = await coordinator.acquireLane("swarm-1", "agent-a", 0, { executionMode: "read_only" })
			const b = await coordinator.acquireLane("swarm-1", "agent-b", 1, { executionMode: "read_only" })
			assert.equal(a.lockSkipped, true)
			assert.equal(b.lockSkipped, true)
			assert.ok(a.claim)
			assert.ok(b.claim)
			assert.equal(a.claim!.lockRequired, false)
			assert.equal(coordinator.getClaimHistory().length, 0)
		})

		it("acquires lock for mutation lanes", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority())
			const result = await coordinator.acquireLane("swarm-1", "agent-a", 0, { executionMode: "mutation" })
			assert.equal(result.lockSkipped, undefined)
			assert.ok(result.claim?.lockClaim)
		})
	})

	describe("merge gate", () => {
		const envelope = (agents: SubagentExecutionEnvelope[]) => ({
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
		})

		it("read-only parallel lanes reading same file do not collide", () => {
			const agentA = buildAgent("a", 0)
			const agentB = buildAgent("b", 1)
			const gate = runMergeGate({
				agents: [agentA, agentB],
				laneReceipts: [
					readOnlyLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						readSet: ["src/shared.ts"],
					}),
					readOnlyLane({
						laneId: "l1",
						agentId: "b",
						index: 1,
						status: "completed",
						readSet: ["src/shared.ts"],
					}),
				],
				claimHistory: [],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agentA, agentB])),
			})
			assert.equal(gate.passed, true)
			assert.ok(!gate.violations.some((v) => v.includes("overlap")))
		})

		it("audit-only lanes inspecting same receipt do not collide", () => {
			const agent = buildAgent("a", 0)
			const gate = runMergeGate({
				agents: [agent, buildAgent("b", 1)],
				laneReceipts: [
					readOnlyLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						executionMode: "audit_only",
						readSet: ["subagent_executions/swarm-1.governed.json"],
					}),
					readOnlyLane({
						laneId: "l1",
						agentId: "b",
						index: 1,
						status: "completed",
						executionMode: "audit_only",
						readSet: ["subagent_executions/swarm-1.governed.json"],
					}),
				],
				claimHistory: [],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agent, buildAgent("b", 1)])),
			})
			assert.equal(gate.passed, true)
		})

		it("non-mutating lane without claim passes gate", () => {
			const agent = buildAgent("a", 0)
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					readOnlyLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						readSet: ["src/a.ts"],
					}),
				],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agent])),
			})
			assert.equal(gate.passed, true)
			assert.ok(!gate.violations.some((v) => v.includes("orphaned")))
			assert.ok(!gate.violations.some((v) => v.includes("unreleased")))
		})

		it("mutation lane without lock fails gate", () => {
			const agent = buildAgent("a", 0)
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						lockRequired: true,
						claimId: undefined,
						writeSet: ["src/out.ts"],
					}),
				],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agent])),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("mutation lane") && v.includes("missing governed lock")))
		})

		it("non-mutating lane with actual writes fails gate", () => {
			const agent = buildAgent("a", 0, {
				toolSteps: [
					{
						index: 0,
						toolName: "write_to_file",
						preview: "write_to_file(path=docs/x.md)",
						resultExcerpt: "ok",
						timestamp: Date.now(),
						touchedPaths: ["docs/x.md"],
						params: { path: "docs/x.md" },
					},
				],
				touchedFiles: ["docs/x.md"],
			})
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					readOnlyLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						executionMode: "documentation_only",
						writeSet: ["docs/x.md"],
					}),
				],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agent])),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("performed writes without lock")))
		})

		it("parallel mutation write overlap still fails", () => {
			const agentA = buildAgent("a", 0)
			const agentB = buildAgent("b", 1)
			const gate = runMergeGate({
				agents: [agentA, agentB],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						claimId: "c1",
						writeSet: ["src/shared.ts"],
					}),
					mutationLane({
						laneId: "l1",
						agentId: "b",
						index: 1,
						status: "completed",
						claimId: "c2",
						writeSet: ["src/shared.ts"],
					}),
				],
				claimHistory: [],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agentA, agentB])),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("unsafe mutation overlap")))
		})

		it("does not count missing claims as orphaned when lockRequired is false", () => {
			const agent = buildAgent("a", 0)
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [readOnlyLane({ laneId: "l0", agentId: "a", index: 0, status: "completed", claimReleased: false })],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope([agent])),
			})
			assert.ok(!gate.violations.some((v) => v.includes("unreleased claims")))
			assert.ok(!gate.violations.some((v) => v.includes("orphaned claims")))
		})
	})
})
