import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { createSwarmValidationSnapshot } from "../executionValidation"
import { loadGovernedReceipt } from "../GovernedExecutionStore"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { createGovernedExecutionPathMetrics } from "../ParentAgentFlowControl"
import { computeSwarmArtifactChecksum, SWARM_TERMINAL_STAGING_VIOLATION } from "../ResumeSwarmFromArtifact"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"
import { persistSwarmEnvelope } from "../SubagentExecutionStore"
import { terminalExecutionEvent } from "./executionFunnelFixture"

function buildAgent(agentId: string, overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(agentId, "exec-1", "researcher", "swarm-1", "task-1", "inspect module", {
		swarmId: "swarm-1",
		index: 1,
		depth: 1,
	})
	builder.setStatus("completed")
	builder.recordToolStep("read_file", "read_file(path=src/a.ts)", "contents", { path: "src/a.ts" }, terminalExecutionEvent())
	builder.setTranscriptMeta("subagent_executions/swarm-1/agents/agent-1.transcript.jsonl", 3, 120)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [], ...overrides }
}

describe("GovernedSwarmCoordinator", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		InMemoryLockAuthority.reset()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("admits swarms when roadmap is disabled", async () => {
		const coordinator = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority())
		const admission = await coordinator.admitSwarm("task-1")
		assert.equal(admission.admitted, true)
		assert.equal(admission.reason, "roadmap_disabled")
	})

	it("acquires and releases scoped work lanes", async () => {
		const coordinator = new GovernedSwarmCoordinator("/tmp", false, 2, undefined, new InMemoryLockAuthority())
		const claim = await coordinator.acquireLane("swarm-a", "agent-1", 0)
		assert.equal(claim.success, true)
		assert.ok(claim.claim)

		await coordinator.releaseLane(claim.claim!, true, false)

		const second = await coordinator.acquireLane("swarm-a", "agent-2", 1)
		assert.equal(second.success, true)
		await coordinator.releaseLane(second.claim!, true, false)
	})

	it("rejects lane acquisition when another agent holds the lane", async () => {
		const coordinator = new GovernedSwarmCoordinator("/tmp", false, 2, undefined, new InMemoryLockAuthority())
		const first = await coordinator.acquireLane("swarm-b", "agent-1", 0)
		assert.equal(first.success, true)

		const second = await coordinator.acquireLane("swarm-b", "agent-2", 0)
		assert.equal(second.success, false)
		assert.match(second.error || "", /claimed|collision|held|ambiguous/i)

		await coordinator.releaseLane(first.claim!, false, true, "collision test cleanup")
	})

	it("seals governed receipt with broccoli-compatible replay integrity", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "governed-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

		const coordinator = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority())
		const agent = buildAgent("agent-a")
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

		assert.equal(receipt.schemaVersion, 3)
		if (!receipt.sealed) {
			throw new Error(`Seal failed: ${JSON.stringify(receipt.mergeGate.violations)}`)
		}
		assert.equal(receipt.sealed, true)
		assert.ok(receipt.governedArtifactPath.includes(".governed."))

		const loaded = await loadGovernedReceipt("task-1", "swarm-1")
		assert.ok(loaded)
		assert.equal(loaded!.laneReceipts.length, 1)
	})

	it("re-acquires lane locks after releaseLaneLocks for parent-layer retry", async () => {
		const coordinator = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority())
		const first = await coordinator.acquireLane("swarm-retry", "agent-a", 0, { executionMode: "mutation" })
		assert.ok(first.success && first.claim)
		await coordinator.releaseLaneLocks(first.claim)
		const second = await coordinator.acquireLane("swarm-retry", "agent-a", 0, { executionMode: "mutation" })
		assert.ok(second.success && second.claim)
		assert.ok(second.claim.lockClaim)
		await coordinator.releaseLane(second.claim, true, false)
		assert.equal(coordinator.getLaneDAG().getNode(0)?.state, "sealed")
	})

	it("selects the clean path and reuses immutable validation across crash-safe persistence", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "governed-fast-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
		const metrics = createGovernedExecutionPathMetrics()
		const coordinator = new GovernedSwarmCoordinator(
			"/tmp",
			false,
			1,
			undefined,
			new InMemoryLockAuthority(),
			"attempt-fast",
			undefined,
			metrics,
		)
		const agent = buildAgent("agent-fast")
		const claim = await coordinator.acquireLane("swarm-fast", "agent-fast", 0, { executionMode: "read_only" })
		assert.ok(claim.claim)
		await coordinator.releaseLane(claim.claim, true, false)
		const envelope: SwarmExecutionEnvelope = {
			swarmId: "swarm-fast",
			executionId: "exec-fast",
			taskId: "task-fast",
			continuity: {
				swarmId: "swarm-fast",
				taskId: "task-fast",
				resumeToken: "swarm-fast:1:1",
				lastPersistedAt: 1,
				completedAgents: 1,
				totalAgents: 1,
				status: "completed",
			},
			agents: [agent],
			blackboardSnapshot: [],
			timestamps: { started: 1, completed: 2 },
			status: "completed",
			invariants: { validated: true, violations: [] },
			artifactPath: "subagent_executions/swarm-fast.json",
			schemaVersion: 1,
		}
		envelope.checksum = computeSwarmArtifactChecksum(envelope)
		const validationSnapshot = createSwarmValidationSnapshot(envelope, envelope.checksum, metrics)

		await persistSwarmEnvelope(
			"task-fast",
			{
				...envelope,
				invariants: { validated: false, violations: [SWARM_TERMINAL_STAGING_VIOLATION] },
			},
			{ validationSnapshot, metrics },
		)
		const receipt = await coordinator.sealReceipt({
			taskId: "task-fast",
			envelope,
			admission: { admitted: true, backoffMs: 0 },
			laneReceipts: [coordinator.buildLaneReceipt(claim.claim, agent, "completed", true)],
			validationSnapshot,
		})
		await persistSwarmEnvelope("task-fast", envelope, { validationSnapshot, metrics })
		const summary = await coordinator.buildReceiptSummary(receipt)

		assert.equal(receipt.continuationDecision?.action, "accept")
		assert.equal(receipt.continuationDecision?.cleanPath, true)
		assert.equal(summary.resourceOwners.length, 0)
		assert.equal(metrics.envelopeValidationCalls, 1)
		assert.equal(metrics.envelopeValidationReuses, 2)
		assert.equal(metrics.claimReconstructions, 1)
		assert.equal(metrics.replayValidationCalls, 2)
		assert.equal(metrics.receiptHistoryReads, 1)
		assert.equal(metrics.envelopePersistenceWrites, 2)
		assert.equal(metrics.receiptPersistenceWrites, 3)
		assert.equal(metrics.continuationReductions, 1)
		assert.equal(metrics.retryDecisions, 0)
		assert.equal(metrics.lockAcquisitions, 0)
	})
})
