import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { acquireGovernedFileLock, recoverStaleGovernedFileLocks } from "@shared/governance/fileLock"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { buildGovernedReceiptSummary, deriveReceiptIncident, isRetrySafe } from "@shared/subagent/governedExecution"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import * as broccoliFence from "@/core/governance/BroccoliFencingAdapter"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { swarmEnvelopeToReplayArtifact } from "../executionReplayMappers"
import {
	listGovernedReceiptAttempts,
	listGovernedReceiptHistory,
	loadAuthoritativeGovernedReceipt,
	loadGovernedReceipt,
	loadGovernedReceiptAttempt,
	validateGovernedReceipt,
} from "../GovernedExecutionStore"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { runMergeGate } from "../MergeGate"
import { explainReplayMismatch, validateDeterministicReplay } from "../ReplayValidator"
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

function buildEnvelope(agents: SubagentExecutionEnvelope[], status: "completed" | "failed" = "completed") {
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
			status,
		},
		agents,
		blackboardSnapshot: [],
		timestamps: { started: Date.now(), completed: Date.now() },
		status,
		invariants: { validated: false, violations: [] },
		artifactPath: "subagent_executions/swarm-1.json",
		schemaVersion: 1 as const,
	}
}

describe("governed execution reliability", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		InMemoryLockAuthority.reset()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	describe("crash safety", () => {
		async function setupCoordinator(attemptId: string, parentAttemptId?: string) {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crash-"))
			const disk = await import("@core/storage/disk")
			sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
			return new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				attemptId,
				parentAttemptId,
			)
		}

		it("crash after claim before execution produces partial failed receipt with active claim", async () => {
			const coordinator = await setupCoordinator("attempt-crash-claim")
			const admission = { admitted: true, backoffMs: 0 }
			await coordinator.admitSwarm("parent")
			const claim = await coordinator.acquireLane("swarm-1", "agent-a", 0)
			assert.equal(claim.success, true)

			const receipt = await coordinator.sealCrashReceipt({
				taskId: "task-1",
				swarmId: "swarm-1",
				executionId: "exec-1",
				admission,
				crashPhase: "after_claim_before_execution",
			})

			assert.equal(receipt.sealed, false)
			assert.ok(receipt.mergeGate.violations.some((v) => v.includes("after_claim_before_execution")))
			assert.ok(receipt.mergeGate.violations.some((v) => v.includes("orphaned claims") || v.includes("unreleased claims")))
			assert.equal(deriveReceiptIncident(receipt), "partial_receipt")
		})

		it("crash after execution before release records unreleased claim", async () => {
			const coordinator = await setupCoordinator("attempt-crash-release")
			const claim = await coordinator.acquireLane("swarm-1", "agent-a", 0)
			const agent = buildAgent("agent-a", 0)
			const laneReceipt = coordinator.buildLaneReceipt(claim.claim!, agent, "completed", false)

			const receipt = await coordinator.sealCrashReceipt({
				taskId: "task-1",
				swarmId: "swarm-1",
				executionId: "exec-1",
				admission: { admitted: true, backoffMs: 0 },
				crashPhase: "after_execution_before_release",
				laneReceipts: [laneReceipt],
			})

			assert.equal(receipt.sealed, false)
			assert.ok(receipt.mergeGate.violations.some((v) => v.includes("unreleased claims")))
		})

		it("crash after release before seal can still seal as failed when evidence incomplete", async () => {
			const coordinator = await setupCoordinator("attempt-crash-seal")
			const claim = await coordinator.acquireLane("swarm-1", "agent-a", 0)
			await coordinator.releaseLane(claim.claim!, false, false)
			const agent = buildAgent("agent-a", 0, { evidenceRefs: [], transcriptArtifactPath: undefined })
			const laneReceipt = coordinator.buildLaneReceipt(claim.claim!, agent, "completed", true)

			const receipt = await coordinator.sealCrashReceipt({
				taskId: "task-1",
				swarmId: "swarm-1",
				executionId: "exec-1",
				admission: { admitted: true, backoffMs: 0 },
				crashPhase: "after_release_before_seal",
				laneReceipts: [laneReceipt],
			})

			assert.equal(receipt.sealed, false)
			assert.ok(receipt.mergeGate.violations.length > 0)
		})

		it("parent interrupted before merge gate leaves in_progress live summary", async () => {
			const coordinator = await setupCoordinator("attempt-live")
			await coordinator.acquireLane("swarm-1", "agent-a", 0)
			const live = coordinator.buildLiveReceiptSummary("swarm-1", { admitted: true, backoffMs: 0 }, [], Date.now())
			assert.equal(live.diagnostics.incident, "in_progress")
			assert.equal(live.sealed, false)
			assert.ok(live.lanesRunning >= 1)
		})

		it("retry while prior attempt partially sealed preserves authoritative sealed receipt", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crash-"))
			const disk = await import("@core/storage/disk")
			sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

			const coordinator1 = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-sealed",
			)
			const agent = buildAgent("agent-a", 0)
			const envelope = buildEnvelope([agent])
			const claim = await coordinator1.acquireLane("swarm-1", "agent-a", 0)
			await coordinator1.releaseLane(claim.claim!, true, false)
			const sealed = await coordinator1.sealReceipt({
				taskId: "task-1",
				envelope,
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [coordinator1.buildLaneReceipt(claim.claim!, agent, "completed", true)],
			})
			assert.equal(sealed.sealed, true)

			const coordinator2 = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-retry",
				"attempt-sealed",
			)
			await coordinator2.acquireLane("swarm-1", "agent-b", 0)
			const partial = await coordinator2.sealCrashReceipt({
				taskId: "task-1",
				swarmId: "swarm-1",
				executionId: "exec-1",
				admission: { admitted: true, backoffMs: 0 },
				crashPhase: "retry_partial_seal",
				retryReason: "lane collision during retry",
			})
			assert.equal(partial.sealed, false)

			const latest = await loadGovernedReceipt("task-1", "swarm-1")
			const authoritative = await loadAuthoritativeGovernedReceipt("task-1", "swarm-1")
			assert.equal(latest?.attemptId, "attempt-sealed")
			assert.equal(authoritative?.attemptId, "attempt-sealed")
			assert.equal(authoritative?.sealed, true)
		})
	})

	describe("lock and fencing correctness", () => {
		it("rejects missing fencing token on release", async () => {
			const authority = new InMemoryLockAuthority()
			const acquired = await authority.acquire("r1", "agent-1")
			assert.equal(acquired.ok, true)
			if (!acquired.ok) return
			const forged = { ...acquired.claim!, fencingToken: 0 }
			const release = await authority.release(forged)
			assert.equal(release.ok, false)
			if (!release.ok) assert.equal(release.reason, "missing_fencing_token")
		})

		it("recovers stale file locks by PID age", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stale-file-"))
			await acquireGovernedFileLock(tempDir, "governed-lane:s:0", "worker-a", 1, 1)
			await new Promise((resolve) => setTimeout(resolve, 5))
			const recovered = await recoverStaleGovernedFileLocks(tempDir, "governed-lane:", 1)
			assert.ok(recovered.length > 0)
		})

		it("fails closed when broccoli fence unavailable after file lock", async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fence-fail-"))
			sinon.stub(broccoliFence, "acquireBroccoliFence").resolves({ ok: false, error: "fence unavailable" })
			const { UnifiedLockAuthority } = await import("@/core/governance/LockAuthority")
			sinon.stub(await import("@/infrastructure/db/Config"), "getDb").rejects(new Error("no db"))
			const authority = new UnifiedLockAuthority()
			const result = await authority.acquire("governed-lane:s:0", "agent-a", {
				workspace: tempDir,
				crossProcess: true,
				requireDurability: false,
			})
			assert.equal(result.ok, false)
			if (!result.ok) assert.equal(result.reason, "split_brain")
			const second = await acquireGovernedFileLock(tempDir, "governed-lane:s:0", "agent-b", 2)
			assert.equal(second.ok, true)
			await fs
				.rm(path.join(tempDir, ".broccolidb", "governed", "locks"), { recursive: true, force: true })
				.catch(() => undefined)
		})

		it("rejects duplicate claimId entries in merge gate", () => {
			const agent = buildAgent("a", 0)
			const envelope = buildEnvelope([agent])
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [
					{
						laneId: "l0",
						agentId: "a",
						index: 0,
						executionMode: "mutation" as const,
						lockRequired: true,
						claimId: "c0",
						status: "completed",
						claimReleased: true,
						evidenceCount: 1,
						touchedFiles: [],
						transcriptArtifactPath: "t.jsonl",
						toolStepCount: 1,
						sealedAt: Date.now(),
					},
				],
				claimHistory: [
					{
						claimId: "dup-1",
						laneId: "l0",
						resourceKey: "k",
						ownerId: "a",
						fencingToken: 1,
						event: "acquired",
						timestamp: 1,
					},
					{
						claimId: "dup-1",
						laneId: "l0",
						resourceKey: "k2",
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
			assert.ok(gate.violations.some((v) => v.includes("duplicate claimId")))
		})
	})

	describe("merge gate hardening", () => {
		const baseLane = {
			laneId: "l0",
			agentId: "a",
			index: 0,
			executionMode: "mutation" as const,
			lockRequired: true,
			claimId: "c0",
			claimReleased: true,
			evidenceCount: 1,
			touchedFiles: [] as string[],
			transcriptArtifactPath: "subagent_executions/swarm-1/agents/a.transcript.jsonl",
			toolStepCount: 1,
			sealedAt: Date.now(),
		}

		it("blocks missing transcript pointer", () => {
			const agent = buildAgent("a", 0)
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [{ ...baseLane, status: "completed", transcriptArtifactPath: undefined }],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(buildEnvelope([agent])),
			})
			assert.ok(gate.violations.some((v) => v.includes("missing transcript pointer")))
		})

		it("blocks failed lane marked successful in envelope", () => {
			const agent = buildAgent("a", 0, { status: "completed" })
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [{ ...baseLane, status: "failed" }],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "failed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(buildEnvelope([agent])),
			})
			assert.ok(gate.violations.some((v) => v.includes("failed lane marked successful")))
		})

		it("blocks replay checksum mismatch when stored checksum provided", () => {
			const agent = buildAgent("a", 0)
			const envelope = buildEnvelope([agent])
			const replay = swarmEnvelopeToReplayArtifact(envelope)
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [{ ...baseLane, status: "completed" }],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: replay,
				storedReplayChecksum: "deadbeef".repeat(8),
			})
			assert.equal(gate.passed, false)
			assert.ok(gate.violations.some((v) => v.includes("replay checksum") || v.includes("checksum")))
		})

		it("blocks unsealed retry superseding sealed receipt", () => {
			const agent = buildAgent("a", 0)
			const priorSealed = {
				schemaVersion: 3 as const,
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				attemptId: "attempt-1",
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				claimHistory: [],
				mergeGate: {
					passed: true,
					mergeAudit: {
						safe: true,
						violations: [],
						overlappingPaths: [],
						missingEvidence: [],
						placeholderWarnings: [],
					},
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
				sealedAt: Date.now(),
				sealed: true,
				integrity: { valid: true, violations: [], checksum: "" },
			}
			const gate = runMergeGate({
				agents: [agent],
				laneReceipts: [{ ...baseLane, status: "completed" }],
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "running" }],
				replayArtifact: swarmEnvelopeToReplayArtifact(buildEnvelope([agent])),
				priorSealedReceipt: priorSealed,
				attemptId: "attempt-2",
			})
			assert.ok(gate.sealedSupersessionBlocked)
		})
	})

	describe("retry and replay confidence", () => {
		async function setupStore() {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "retry-"))
			const disk = await import("@core/storage/disk")
			sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
		}

		it("append-only history links retries with parentAttemptId and retryReason", async () => {
			await setupStore()
			const coordinator = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-1",
			)
			const agent = buildAgent("agent-a", 0)
			const envelope = buildEnvelope([agent])
			const claim = await coordinator.acquireLane("swarm-1", "agent-a", 0)
			await coordinator.releaseLane(claim.claim!, true, false)
			await coordinator.sealReceipt({
				taskId: "task-1",
				envelope,
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [coordinator.buildLaneReceipt(claim.claim!, agent, "completed", true)],
			})

			const retry = new GovernedSwarmCoordinator(
				"/tmp",
				false,
				1,
				undefined,
				new InMemoryLockAuthority(),
				"attempt-2",
				"attempt-1",
			)
			await retry.sealCrashReceipt({
				taskId: "task-1",
				swarmId: "swarm-1",
				executionId: "exec-1",
				admission: { admitted: true, backoffMs: 0 },
				crashPhase: "retry_partial_seal",
				retryReason: "merge gate blocked",
			})

			const history = await listGovernedReceiptHistory("task-1", "swarm-1")
			assert.equal(history.length, 2)
			assert.equal(history[1].parentAttemptId, "attempt-1")
			assert.equal(history[1].retryReason, "merge gate blocked")
			const attempts = await listGovernedReceiptAttempts("task-1", "swarm-1")
			assert.deepEqual(attempts, ["attempt-1", "attempt-2"])
		})

		it("validateGovernedReceipt rejects corrupted receipt", () => {
			const result = validateGovernedReceipt({ schemaVersion: 1, swarmId: "s" })
			assert.equal(result.corrupted, true)
			assert.ok(result.violations.length > 0)
		})

		it("explainReplayMismatch produces operator-readable causes", () => {
			const explained = explainReplayMismatch(["replay checksum mismatch — non-deterministic state detected"])
			assert.ok(explained[0].includes("mutated"))
		})

		it("isRetrySafe blocks when active claims remain", () => {
			const receipt = {
				schemaVersion: 3 as const,
				swarmId: "s",
				executionId: "e",
				taskId: "t",
				attemptId: "a2",
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [],
				laneDag: [],
				claimHistory: [
					{ laneId: "l0", resourceKey: "k", ownerId: "a", fencingToken: 1, event: "acquired", timestamp: 1 },
				],
				mergeGate: {
					passed: false,
					mergeAudit: {
						safe: false,
						violations: [],
						overlappingPaths: [],
						missingEvidence: [],
						placeholderWarnings: [],
					},
					replayIntegrity: { valid: true, violations: [], checksum: "" },
					violations: [],
					failedLaneCount: 0,
					orphanedClaimCount: 1,
					staleLeaseCount: 0,
					splitBrainDetected: false,
					sealedSupersessionBlocked: false,
				},
				replayArtifactPath: "",
				governedArtifactPath: "",
				sealedAt: 0,
				sealed: false,
				integrity: { valid: false, violations: [], checksum: "" },
			}
			const retry = isRetrySafe(receipt)
			assert.equal(retry.safe, false)
			assert.ok(retry.reason?.includes("Active claims"))
		})

		it("deterministic replay checksum is stable for same inputs", async () => {
			await setupStore()
			const coordinator = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority())
			const agent = buildAgent("agent-a", 0)
			const envelope = buildEnvelope([agent])
			const claim = await coordinator.acquireLane("swarm-1", "agent-a", 0)
			await coordinator.releaseLane(claim.claim!, true, false)
			const receipt = await coordinator.sealReceipt({
				taskId: "task-1",
				envelope,
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [coordinator.buildLaneReceipt(claim.claim!, agent, "completed", true)],
			})
			const replay = swarmEnvelopeToReplayArtifact(envelope)
			const first = validateDeterministicReplay(receipt, replay)
			const loaded = await loadGovernedReceiptAttempt("task-1", "swarm-1", receipt.attemptId)
			const second = validateDeterministicReplay(loaded!, replay)
			assert.equal(first.deterministicChecksum, second.deterministicChecksum)
		})
	})

	describe("operator diagnostics", () => {
		it("buildGovernedReceiptSummary exposes incident and retry safety", async () => {
			const receipt = {
				schemaVersion: 3 as const,
				swarmId: "swarm-1",
				executionId: "exec-1",
				taskId: "task-1",
				attemptId: "attempt-1",
				admission: { admitted: true, backoffMs: 0 },
				laneReceipts: [
					{
						laneId: "l0",
						agentId: "a",
						index: 0,
						status: "completed" as const,
						claimReleased: true,
						evidenceCount: 1,
						touchedFiles: ["src/a.ts"],
						transcriptArtifactPath: "t.jsonl",
						toolStepCount: 1,
						sealedAt: Date.now(),
					},
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" as const }],
				claimHistory: [],
				mergeGate: {
					passed: true,
					mergeAudit: {
						safe: true,
						violations: [],
						overlappingPaths: [],
						missingEvidence: [],
						placeholderWarnings: [],
					},
					replayIntegrity: { valid: true, violations: [], checksum: "abc" },
					violations: [],
					failedLaneCount: 0,
					orphanedClaimCount: 0,
					staleLeaseCount: 0,
					splitBrainDetected: false,
					sealedSupersessionBlocked: false,
				},
				replayArtifactPath: "subagent_executions/swarm-1.json",
				governedArtifactPath: "subagent_executions/swarm-1.governed.attempt-1.json",
				replayChecksum: "abc",
				sealedAt: Date.now(),
				sealed: true,
				integrity: { valid: true, violations: [], checksum: "abc" },
			}
			const summary = buildGovernedReceiptSummary(receipt, [
				{ attemptId: "attempt-1", sealed: true, mergePassed: true, timestamp: Date.now() },
			])
			assert.equal(summary.diagnostics.incident, "sealed_success")
			assert.equal(summary.diagnostics.retrySafe, true)
			assert.equal(summary.diagnostics.authoritativeAttemptId, "attempt-1")
		})
	})
})
