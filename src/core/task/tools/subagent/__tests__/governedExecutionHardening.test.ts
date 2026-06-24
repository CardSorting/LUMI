import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { swarmEnvelopeToReplayArtifact } from "../executionReplayMappers"
import { listGovernedReceiptAttempts, loadGovernedReceipt } from "../GovernedExecutionStore"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { LaneDAG } from "../LaneDAG"
import { runMergeGate } from "../MergeGate"
import { validateDeterministicReplay } from "../ReplayValidator"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"

function buildAgent(agentId: string, index: number, overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(agentId, "exec-1", "researcher", "swarm-1", "task-1", "inspect module", {
		swarmId: "swarm-1",
		index,
		depth: 1,
	})
	builder.setStatus("completed")
	builder.recordToolStep("read_file", "read_file(path=src/a.ts)", "contents", { path: "src/a.ts" })
	builder.setTranscriptMeta("subagent_executions/swarm-1/agents/agent-1.transcript.jsonl", 3, 120)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [], ...overrides }
}

function mutationLane(overrides: Record<string, unknown>) {
	return {
		executionMode: "mutation" as const,
		lockRequired: true,
		claimReleased: true,
		evidenceCount: 1,
		toolStepCount: 1,
		transcriptArtifactPath: "subagent_executions/swarm-1/agents/a.transcript.jsonl",
		sealedAt: Date.now(),
		touchedFiles: [],
		...overrides,
	}
}

describe("governed execution hardening", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		InMemoryLockAuthority.reset()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	describe("LockAuthority", () => {
		it("rejects duplicate claims from different owners", async () => {
			const authority = new InMemoryLockAuthority()
			const first = await authority.acquire("resource-a", "agent-1")
			assert.equal(first.ok, true)

			const second = await authority.acquire("resource-a", "agent-2")
			assert.equal(second.ok, false)
			if (!second.ok) {
				assert.equal(second.reason, "collision")
			}

			await authority.release(first.claim!)
		})

		it("rejects owner mismatch on release", async () => {
			const authority = new InMemoryLockAuthority()
			const first = await authority.acquire("resource-x", "agent-1")
			assert.equal(first.ok, true)
			if (!first.ok) return

			const forged = { ...first.claim!, ownerId: "agent-2" }
			const release = await authority.release(forged)
			assert.equal(release.ok, false)
			if (!release.ok) {
				assert.equal(release.reason, "owner_mismatch")
			}
			await authority.release(first.claim!)
		})

		it("rejects fencing token mismatch on release", async () => {
			const authority = new InMemoryLockAuthority()
			const first = await authority.acquire("resource-y", "agent-1")
			assert.equal(first.ok, true)
			if (!first.ok) return

			const forged = { ...first.claim!, fencingToken: first.claim!.fencingToken + 99 }
			const release = await authority.release(forged)
			assert.equal(release.ok, false)
			if (!release.ok) {
				assert.equal(release.reason, "fencing_mismatch")
			}
			await authority.release(first.claim!)
		})

		it("recovers stale in-memory claims", async () => {
			const authority = new InMemoryLockAuthority()
			const result = await authority.acquire("resource-b", "agent-1", { timeoutMs: 1 })
			assert.equal(result.ok, true)
			await new Promise((resolve) => setTimeout(resolve, 5))

			const recovery = await authority.recoverStale("/tmp")
			assert.ok(recovery.recovered.includes("resource-b"))
		})
	})

	describe("LaneDAG", () => {
		it("blocks lanes until dependencies are sealed", () => {
			const deps = new Map<number, number[]>([[1, [0]]])
			const dag = new LaneDAG(2, deps)
			assert.deepEqual(dag.getReadyLanes(), [0])
			assert.equal(dag.getNode(1)?.state, "blocked")

			dag.markRunning(0, "agent-a")
			dag.markSealed(0)
			assert.deepEqual(dag.getReadyLanes(), [1])
		})
	})

	describe("MergeGate", () => {
		it("fails on overlapping touched files without DAG ordering", () => {
			const agentA = buildAgent("a", 0, { touchedFiles: ["src/shared.ts"] })
			const agentB = buildAgent("b", 1, { touchedFiles: ["src/shared.ts"] })
			const envelope = {
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				continuity: {
					swarmId: "swarm-1",
					taskId: "task-1",
					resumeToken: "t",
					lastPersistedAt: Date.now(),
					completedAgents: 2,
					totalAgents: 2,
					status: "completed" as const,
				},
				agents: [agentA, agentB],
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "completed" as const,
				invariants: { validated: false, violations: [] },
				artifactPath: "subagent_executions/swarm-1.json",
				schemaVersion: 1 as const,
			}
			const replay = swarmEnvelopeToReplayArtifact(envelope)
			const gate = runMergeGate({
				agents: [agentA, agentB],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						claimId: "c0",
						writeSet: ["src/shared.ts"],
						touchedFiles: ["src/shared.ts"],
					}),
					mutationLane({
						laneId: "l1",
						agentId: "b",
						index: 1,
						status: "completed",
						claimId: "c1",
						writeSet: ["src/shared.ts"],
						touchedFiles: ["src/shared.ts"],
					}),
				],
				claimHistory: [],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				replayArtifact: replay,
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("unsafe mutation overlap")))
		})

		it("allows overlapping touched files when DAG dependency orders lanes", () => {
			const agentA = buildAgent("a", 0, { touchedFiles: ["src/shared.ts"] })
			const agentB = buildAgent("b", 1, { touchedFiles: ["src/shared.ts"] })
			const envelope = {
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				continuity: {
					swarmId: "swarm-1",
					taskId: "task-1",
					resumeToken: "t",
					lastPersistedAt: Date.now(),
					completedAgents: 2,
					totalAgents: 2,
					status: "completed" as const,
				},
				agents: [agentA, agentB],
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "completed" as const,
				invariants: { validated: false, violations: [] },
				artifactPath: "subagent_executions/swarm-1.json",
				schemaVersion: 1 as const,
			}
			const gate = runMergeGate({
				agents: [agentA, agentB],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						claimId: "c0",
						writeSet: ["src/shared.ts"],
						touchedFiles: ["src/shared.ts"],
					}),
					mutationLane({
						laneId: "l1",
						agentId: "b",
						index: 1,
						status: "completed",
						claimId: "c1",
						writeSet: ["src/shared.ts"],
						touchedFiles: ["src/shared.ts"],
					}),
				],
				claimHistory: [],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [0], state: "sealed" },
				],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope),
			})
			assert.equal(gate.mergeAudit.overlappingPaths.length, 1)
			assert.ok(!gate.violations.some((v) => v.includes("unsafe mutation overlap")))
		})

		it("fails on missing evidence and placeholders", () => {
			const agent = buildAgent("a", 0, {
				evidenceRefs: [],
				verbatimOutput: "Done. TODO: finish.",
			})
			const envelope = {
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				continuity: {
					swarmId: "swarm-1",
					taskId: "task-1",
					resumeToken: "t",
					lastPersistedAt: Date.now(),
					completedAgents: 1,
					totalAgents: 1,
					status: "completed" as const,
				},
				agents: [agent],
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "completed" as const,
				invariants: { validated: false, violations: [] },
				artifactPath: "subagent_executions/swarm-1.json",
				schemaVersion: 1 as const,
			}
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						claimId: "c0",
						claimReleased: true,
						evidenceCount: 0,
						toolStepCount: 0,
						transcriptArtifactPath: undefined,
						touchedFiles: [],
					}),
				],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope),
			})
			assert.equal(gate.passed, false)
		})

		it("fails on orphaned claims and failed lanes", () => {
			const agent = buildAgent("a", 0)
			const envelope = {
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				continuity: {
					swarmId: "swarm-1",
					taskId: "task-1",
					resumeToken: "t",
					lastPersistedAt: Date.now(),
					completedAgents: 0,
					totalAgents: 1,
					status: "failed" as const,
				},
				agents: [agent],
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "failed" as const,
				invariants: { validated: false, violations: [] },
				artifactPath: "subagent_executions/swarm-1.json",
				schemaVersion: 1 as const,
			}
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "failed",
						claimId: "c0",
						claimReleased: false,
						evidenceCount: 0,
						toolStepCount: 0,
						transcriptArtifactPath: undefined,
						touchedFiles: [],
						error: "worker crash",
					}),
				],
				claimHistory: [
					{
						laneId: "l0",
						resourceKey: "k",
						ownerId: "a",
						fencingToken: 1,
						event: "stale_detected",
						timestamp: Date.now(),
					},
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "failed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.orphanedClaimCount > 0)
			assert.ok(gate.staleLeaseCount > 0)
		})

		it("detects duplicate claims in merge gate", () => {
			const agent = buildAgent("a", 0)
			const envelope = {
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				continuity: {
					swarmId: "swarm-1",
					taskId: "task-1",
					resumeToken: "t",
					lastPersistedAt: Date.now(),
					completedAgents: 1,
					totalAgents: 1,
					status: "completed" as const,
				},
				agents: [agent],
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "completed" as const,
				invariants: { validated: false, violations: [] },
				artifactPath: "subagent_executions/swarm-1.json",
				schemaVersion: 1 as const,
			}
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					mutationLane({
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed",
						claimId: "c0",
						touchedFiles: [],
					}),
				],
				claimHistory: [
					{
						laneId: "l0",
						resourceKey: "governed-lane:s:0",
						ownerId: "a",
						fencingToken: 1,
						event: "acquired",
						timestamp: 1,
					},
					{
						laneId: "l0",
						resourceKey: "governed-lane:s:0",
						ownerId: "b",
						fencingToken: 2,
						event: "acquired",
						timestamp: 2,
					},
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(envelope),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("duplicate claim")))
		})
	})

	describe("GovernedFileLock", () => {
		it("acquires and rejects cross-process collisions", async () => {
			const fileLock = await import("@shared/governance/fileLock")
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "filelock-"))
			const first = await fileLock.acquireGovernedFileLock(tempDir, "governed-lane:s:0", "worker-a", 1)
			assert.equal(first.ok, true)
			const second = await fileLock.acquireGovernedFileLock(tempDir, "governed-lane:s:0", "worker-b", 2)
			assert.equal(second.ok, false)
			await fileLock.releaseGovernedFileLock(tempDir, "governed-lane:s:0", "worker-a")
		})

		it("recovers stale file locks", async () => {
			const fileLock = await import("@shared/governance/fileLock")
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "filelock-stale-"))
			await fileLock.acquireGovernedFileLock(tempDir, "governed-lane:s:1", "worker-a", 1, 1)
			await new Promise((resolve) => setTimeout(resolve, 5))
			const recovered = await fileLock.recoverStaleGovernedFileLocks(tempDir, "governed-lane:", 1)
			assert.ok(recovered.length > 0)
		})
	})

	describe("worker_cli", () => {
		it("executes governed lane and writes receipt", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-"))
			const { execFile } = await import("node:child_process")
			const { promisify } = await import("node:util")
			const execFileAsync = promisify(execFile)
			await execFileAsync(
				"npx",
				["tsx", "broccolidb/worker_cli.ts", "--worker-id", "w-ok", "--prompt", "test", "--workspace", tempDir],
				{
					cwd: path.join(process.cwd()),
				},
			)
			const receipt = JSON.parse(
				await fs.readFile(path.join(tempDir, ".broccolidb/governed/receipts/w-ok.json"), "utf8"),
			) as { status: string; claimReleased: boolean }
			assert.equal(receipt.status, "completed")
			assert.equal(receipt.claimReleased, true)
		})

		it("writes failed receipt on worker failure", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-fail-"))
			const { execFile } = await import("node:child_process")
			const { promisify } = await import("node:util")
			const execFileAsync = promisify(execFile)
			try {
				await execFileAsync(
					"npx",
					[
						"tsx",
						"broccolidb/worker_cli.ts",
						"--worker-id",
						"w-fail",
						"--prompt",
						"test",
						"--workspace",
						tempDir,
						"--fail",
					],
					{ cwd: path.join(process.cwd()) },
				)
			} catch {
				// expected non-zero exit
			}
			const receipt = JSON.parse(
				await fs.readFile(path.join(tempDir, ".broccolidb/governed/receipts/w-fail.json"), "utf8"),
			) as { status: string; error?: string }
			assert.equal(receipt.status, "failed")
			assert.ok(receipt.error)
		})
	})

	describe("GovernedSwarmCoordinator", () => {
		it("admits swarms when roadmap is disabled", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority())
			const admission = await coordinator.admitSwarm("task-1")
			assert.equal(admission.admitted, true)
		})

		it("rejects pressure when roadmap admission fails", async () => {
			const roadmap = await import("@/services/roadmap/RoadmapService")
			const stub = sinon.stub(roadmap.RoadmapService.getInstance(), "scheduleAdmission").resolves({
				admitted: false,
				backoff_ms: 5000,
			})
			const coordinator = new GovernedSwarmCoordinator("/tmp", true, 1, undefined, new InMemoryLockAuthority())
			const admission = await coordinator.admitSwarm("task-1")
			assert.equal(admission.admitted, false)
			assert.equal(admission.backoffMs, 5000)
			stub.restore()
		})

		it("acquires and releases lanes through LockAuthority", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", false, 2, undefined, new InMemoryLockAuthority())
			const claim = await coordinator.acquireLane("swarm-a", "agent-1", 0)
			assert.equal(claim.success, true)
			await coordinator.releaseLane(claim.claim!, true, false)
			const receipt = coordinator.buildLaneReceipt(claim.claim!, undefined, "completed", true)
			assert.equal(receipt.claimReleased, true)
		})

		it("seals receipt with retry history preserved", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "governed-"))
			const disk = await import("@core/storage/disk")
			sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

			const coordinator = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-1",
			)
			const agent = buildAgent("agent-a", 0)
			const envelope = {
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				continuity: {
					swarmId: "swarm-1",
					taskId: "task-1",
					resumeToken: "swarm-1:1:1",
					lastPersistedAt: Date.now(),
					completedAgents: 1,
					totalAgents: 1,
					status: "completed" as const,
				},
				agents: [agent],
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "completed" as const,
				invariants: { validated: false, violations: [] },
				artifactPath: "subagent_executions/swarm-1.json",
				schemaVersion: 1 as const,
			}

			const claim = await coordinator.acquireLane("swarm-1", "agent-a", 0)
			await coordinator.releaseLane(claim.claim!, true, false)

			const receipt = await coordinator.sealReceipt({
				taskId: "task-1",
				envelope,
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [coordinator.buildLaneReceipt(claim.claim!, agent, "completed", true)],
			})

			assert.equal(receipt.sealed, true)
			assert.equal(receipt.attemptId, "attempt-1")
			assert.ok(receipt.replayChecksum)

			const retryCoordinator = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-2",
				"attempt-1",
			)
			const retryReceipt = await retryCoordinator.sealReceipt({
				taskId: "task-1",
				envelope,
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [retryCoordinator.buildLaneReceipt(claim.claim!, agent, "completed", true)],
				forceFail: true,
			})
			assert.equal(retryReceipt.sealed, false)
			assert.equal(retryReceipt.parentAttemptId, "attempt-1")

			const attempts = await listGovernedReceiptAttempts("task-1", "swarm-1")
			assert.ok(attempts.includes("attempt-1"))
			assert.ok(attempts.includes("attempt-2"))

			const loaded = await loadGovernedReceipt("task-1", "swarm-1")
			assert.equal(loaded?.attemptId, "attempt-1")

			const replayValidation = validateDeterministicReplay(receipt, swarmEnvelopeToReplayArtifact(envelope))
			assert.equal(replayValidation.valid, true)
		})
	})
})
