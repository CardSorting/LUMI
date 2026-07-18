import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { buildOrchestrationLeaseTaskId, deriveReceiptIncident } from "@shared/subagent/governedExecution"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { setRoadmapConfigOverride } from "@/services/roadmap/RoadmapConfig"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { buildGovernedArtifactRelativePath, loadAuthoritativeGovernedReceipt } from "../GovernedExecutionStore"
import {
	AUDIT_STORAGE_BOUNDARY,
	applyGovernedRoadmapCompletionPolicy,
	assertGovernedReceiptStoragePath,
	BROCCOLI_SUBSTRATE_BOUNDARY,
	inferSwarmCrashPhase,
	resolveGovernedRoadmapCompletionPolicy,
} from "../GovernedIntegration"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"
import { terminalExecutionEvent } from "./executionFunnelFixture"

function buildAgent(agentId: string, index: number): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(agentId, "exec-1", "researcher", "swarm-close", "task-1", "work", {
		swarmId: "swarm-close",
		index,
		depth: 1,
	})
	builder.setStatus("completed")
	builder.recordToolStep("read_file", "read_file(path=src/a.ts)", "ok", { path: "src/a.ts" }, terminalExecutionEvent())
	builder.setTranscriptMeta("subagent_executions/swarm-close/a.transcript.jsonl", 1, 40)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [] }
}

describe("governed execution closure pass", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		setRoadmapConfigOverride(null)
		InMemoryLockAuthority.reset()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	async function setupStore() {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gov-close-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
	}

	describe("orchestration lease", () => {
		it("admission succeeds but orchestration lease fails — coordinator reports not acquired", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gov-lease-"))
			setRoadmapConfigOverride({ enabled: true, block_kanban_on_bootstrap_incomplete: false })
			const svc = RoadmapService.getInstance()
			const taskId = buildOrchestrationLeaseTaskId("swarm-close")
			await svc.acquireOrchestrationLease(tempDir, "other-agent", taskId, 60)

			const coord = new GovernedSwarmCoordinator(tempDir, true, 1, undefined, new InMemoryLockAuthority())
			const admission = await coord.admitSwarm("parent-agent")
			assert.equal(admission.admitted, true)

			const lease = await coord.acquireSwarmOrchestrationLease("swarm-close", "parent-agent")
			assert.equal(lease.acquired, false)
		})

		it("orchestration lease acquired — receipt records lease", async () => {
			await setupStore()
			tempDir = path.join(tempDir, "ws")
			await fs.mkdir(tempDir, { recursive: true })
			setRoadmapConfigOverride({ enabled: true, block_kanban_on_bootstrap_incomplete: false })

			const coord = new GovernedSwarmCoordinator(tempDir, true, 1, undefined, new InMemoryLockAuthority(), "attempt-lease")
			const admission = await coord.admitSwarm("parent-agent")
			const lease = await coord.acquireSwarmOrchestrationLease("swarm-close", "parent-agent")
			assert.equal(lease.acquired, true)

			const claim = await coord.acquireLane("swarm-close", "a0", 0, { executionMode: "read_only" })
			await coord.releaseLane(claim.claim!, true)
			const laneReceipt = coord.buildLaneReceipt(claim.claim!, buildAgent("a0", 0), "completed", true)

			const receipt = await coord.sealReceipt({
				taskId: "task-close",
				envelope: {
					swarmId: "swarm-close",
					executionId: "e1",
					taskId: "task-close",
					continuity: {
						swarmId: "swarm-close",
						taskId: "task-close",
						resumeToken: "t",
						lastPersistedAt: Date.now(),
						completedAgents: 1,
						totalAgents: 1,
						status: "completed",
					},
					agents: [buildAgent("a0", 0)],
					blackboardSnapshot: [],
					timestamps: { started: Date.now(), completed: Date.now() },
					status: "completed",
					invariants: { validated: true, violations: [] },
					artifactPath: "subagent_executions/swarm-close.json",
					schemaVersion: 1,
				},
				admission,
				laneReceipts: [laneReceipt],
				completionPolicy: "advisory_only",
			})

			assert.ok(receipt.roadmapLinkage?.orchestrationLease?.acquired)
			assert.equal(receipt.roadmapLinkage?.orchestrationLease?.released, true)
			assert.equal(receipt.roadmapLinkage?.orchestrationLease?.taskId, buildOrchestrationLeaseTaskId("swarm-close"))
		})

		it("crash after lease acquisition records lease state on crash receipt", async () => {
			await setupStore()
			tempDir = path.join(tempDir, "ws")
			await fs.mkdir(tempDir, { recursive: true })
			setRoadmapConfigOverride({ enabled: true, block_kanban_on_bootstrap_incomplete: false })

			const coord = new GovernedSwarmCoordinator(tempDir, true, 1, undefined, new InMemoryLockAuthority())
			const admission = await coord.admitSwarm("parent-agent")
			await coord.acquireSwarmOrchestrationLease("swarm-close", "parent-agent")
			await coord.acquireLane("swarm-close", "a0", 0)

			const receipt = await coord.sealCrashReceipt({
				taskId: "task-close",
				swarmId: "swarm-close",
				executionId: "e1",
				admission,
				crashPhase: "after_claim_before_execution",
				completionPolicy: "advisory_only",
			})

			assert.ok(receipt.roadmapLinkage?.orchestrationLease?.acquired)
			assert.equal(receipt.roadmapLinkage?.orchestrationLease?.released, true)
			assert.equal(deriveReceiptIncident(receipt), "partial_receipt")
		})
	})

	describe("roadmap completion policy", () => {
		it("advisory-only mode records no mutation", async () => {
			const outcome = await applyGovernedRoadmapCompletionPolicy({
				workspace: "/tmp",
				policy: "advisory_only",
				sealed: true,
				mergePassed: true,
				integrityValid: true,
			})
			assert.equal(outcome.status, "advisory_only")
		})

		it("failed merge blocks roadmap mutation even when update enabled", async () => {
			const outcome = await applyGovernedRoadmapCompletionPolicy({
				workspace: "/tmp",
				policy: "update_on_sealed_success",
				sealed: false,
				mergePassed: false,
				integrityValid: false,
			})
			assert.equal(outcome.status, "blocked")
			assert.equal(outcome.reason, "receipt_not_sealed_success")
		})

		it("replay mismatch blocks roadmap mutation", async () => {
			const outcome = await applyGovernedRoadmapCompletionPolicy({
				workspace: "/tmp",
				policy: "update_on_sealed_success",
				sealed: true,
				mergePassed: true,
				integrityValid: true,
				replayMismatch: true,
			})
			assert.equal(outcome.status, "blocked")
			assert.equal(outcome.reason, "replay_mismatch")
		})

		it("resolveGovernedRoadmapCompletionPolicy reads param", () => {
			assert.equal(resolveGovernedRoadmapCompletionPolicy({}), "advisory_only")
			assert.equal(
				resolveGovernedRoadmapCompletionPolicy({ roadmap_completion_update: "enabled" }),
				"update_on_sealed_success",
			)
		})
	})

	describe("crash sealing", () => {
		it("timeout after claim before execution — crash phase and orphaned claim", async () => {
			const phase = inferSwarmCrashPhase({
				laneReceipts: [],
				claimHistory: [
					{
						laneId: "l0",
						resourceKey: "k",
						ownerId: "a0",
						fencingToken: 1,
						event: "acquired",
						timestamp: Date.now(),
					},
				],
				dagRunning: true,
			})
			assert.equal(phase, "after_claim_before_execution")
		})

		it("prior sealed success remains authoritative over crash retry", async () => {
			await setupStore()
			const coord1 = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority(), "attempt-1")
			const agent = buildAgent("a0", 0)
			const claim = await coord1.acquireLane("swarm-close", "a0", 0, { executionMode: "read_only" })
			await coord1.releaseLane(claim.claim!, true)
			const sealed = await coord1.sealReceipt({
				taskId: "task-close",
				envelope: {
					swarmId: "swarm-close",
					executionId: "e1",
					taskId: "task-close",
					continuity: {
						swarmId: "swarm-close",
						taskId: "task-close",
						resumeToken: "t",
						lastPersistedAt: Date.now(),
						completedAgents: 1,
						totalAgents: 1,
						status: "completed",
					},
					agents: [agent],
					blackboardSnapshot: [],
					timestamps: { started: Date.now(), completed: Date.now() },
					status: "completed",
					invariants: { validated: true, violations: [] },
					artifactPath: "subagent_executions/swarm-close.json",
					schemaVersion: 1,
				},
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [coord1.buildLaneReceipt(claim.claim!, agent, "completed", true)],
			})
			assert.equal(sealed.sealed, true)

			const coord2 = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-2",
				"attempt-1",
			)
			const crash = await coord2.sealCrashReceipt({
				taskId: "task-close",
				swarmId: "swarm-close",
				executionId: "e2",
				admission: { admitted: true, backoffMs: 0 },
				crashPhase: "parent_before_merge_gate",
			})

			const authoritative = await loadAuthoritativeGovernedReceipt("task-close", "swarm-close")
			assert.equal(authoritative?.attemptId, "attempt-1")
			assert.equal(authoritative?.sealed, true)
			assert.equal(crash.sealed, false)
		})
	})

	describe("broccoli audit scope boundary", () => {
		it("governed receipt paths remain under subagent_executions", () => {
			const path = buildGovernedArtifactRelativePath("swarm-close", "attempt-1")
			assert.ok(assertGovernedReceiptStoragePath(path))
			assert.ok(path.startsWith("subagent_executions/"))
		})

		it("documents substrate vs audit storage boundaries", () => {
			assert.ok(AUDIT_STORAGE_BOUNDARY.includes("subagent_executions"))
			assert.ok(BROCCOLI_SUBSTRATE_BOUNDARY.includes("fencing"))
			assert.ok(BROCCOLI_SUBSTRATE_BOUNDARY.includes("receipt-local"))
		})
	})
})
