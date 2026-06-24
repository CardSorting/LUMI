import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { swarmEnvelopeToReplayArtifact } from "../executionReplayMappers"
import {
	AUDIT_STORAGE_BOUNDARY,
	auditFalsePositiveLocks,
	buildGovernedAuditIntegration,
	buildLaneDependencyMap,
	buildLaneRoadmapItemMap,
	MERGE_GATE_ROLE,
	ROADMAP_INTEGRATION_PARTIAL,
} from "../GovernedIntegration"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { parseDependsOnFromPrompt, parseRoadmapItemFromPrompt, resolveLaneLockIntent } from "../LockNecessity"
import { runMergeGate } from "../MergeGate"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"

function buildAgent(agentId: string, index: number): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(agentId, "exec-1", "researcher", "swarm-int", "task-1", "work", {
		swarmId: "swarm-int",
		index,
		depth: 1,
	})
	builder.setStatus("completed")
	builder.setPhase("completion_gate")
	builder.recordToolStep("read_file", "read_file(path=src/a.ts)", "ok", { path: "src/a.ts" })
	builder.setTranscriptMeta("subagent_executions/swarm-int/a.transcript.jsonl", 1, 40)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [], phase: "completion_gate" }
}

describe("governed execution roadmap and audit integration", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		InMemoryLockAuthority.reset()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	async function setupStore() {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gov-int-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
	}
	describe("roadmap linkage parsing", () => {
		it("parses depends_on and roadmap_item prompt tags", () => {
			assert.deepEqual(parseDependsOnFromPrompt("[depends_on:0,1] follow-up"), [0, 1])
			assert.equal(parseRoadmapItemFromPrompt("[roadmap_item:NOW-42] audit lane"), "NOW-42")
		})

		it("builds lane dependency map from prompts and params", () => {
			const prompts = ["lane zero", "[depends_on:0] lane one", "lane two"]
			const deps = buildLaneDependencyMap(prompts, { depends_on_3: "0,1" })
			assert.deepEqual(deps.get(1), [0])
			assert.deepEqual(deps.get(2), [0, 1])
		})

		it("builds per-lane roadmap item map", () => {
			const items = buildLaneRoadmapItemMap(["[roadmap_item:A] x", "y"], { roadmap_item_2: "B" })
			assert.equal(items.get(0), "A")
			assert.equal(items.get(1), "B")
		})
	})

	describe("lane DAG scheduling", () => {
		const dagPrompts = ["[execution_mode:read_only] first", "[depends_on:0] second"]

		it("blocks dependent lane until upstream is sealed", async () => {
			const deps = buildLaneDependencyMap(dagPrompts)
			const coord = new GovernedSwarmCoordinator("/tmp", false, 2, deps, new InMemoryLockAuthority())
			assert.ok(coord.isLaneReady(0))
			assert.ok(!coord.isLaneReady(1))

			const first = await coord.acquireLane("swarm-int", "agent-0", 0, resolveLaneLockIntent(dagPrompts[0]))
			assert.ok(first.success && first.claim)
			assert.ok(!coord.isLaneReady(1))

			await coord.releaseLane(first.claim, true)
			assert.ok(coord.isLaneReady(1))
		})
	})

	describe("admission pressure score", () => {
		it("scheduleAdmission returns pressure_score", async () => {
			const svc = RoadmapService.getInstance()
			const tmpDir = await import("node:os").then((os) => os.tmpdir())
			const admission = await svc.scheduleAdmission(tmpDir, "agent-test", "subagent_swarm")
			assert.equal(typeof admission.pressure_score, "number")
		})
	})

	describe("audit boundaries", () => {
		it("records merge gate as commit barrier only", () => {
			const laneReceipts = [
				{
					laneId: "l0",
					agentId: "a0",
					index: 0,
					status: "completed" as const,
					claimReleased: true,
					evidenceCount: 1,
					touchedFiles: [],
					sealedAt: Date.now(),
					executionMode: "read_only" as const,
					lockRequired: false,
				},
			]
			const agents = [buildAgent("a0", 0)]
			const mergeGate = runMergeGate({
				agents,
				laneReceipts,
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: swarmEnvelopeToReplayArtifact({
					swarmId: "swarm-int",
					executionId: "e1",
					taskId: "task-1",
					continuity: {
						swarmId: "swarm-int",
						taskId: "task-1",
						resumeToken: "t",
						lastPersistedAt: Date.now(),
						completedAgents: 1,
						totalAgents: 1,
						status: "completed",
					},
					agents,
					blackboardSnapshot: [],
					timestamps: { started: Date.now(), completed: Date.now() },
					status: "completed",
					invariants: { validated: true, violations: [] },
					artifactPath: "subagent_executions/swarm-int.json",
					schemaVersion: 1,
				}),
				attemptId: "attempt-1",
			})

			const audit = buildGovernedAuditIntegration({
				preflightIssues: [{ stage: "roadmap_governance", message: "dry-run ok", severity: "info" }],
				laneReceipts,
				mergeGate,
				agents,
				receiptIntegrityValid: true,
			})

			assert.equal(audit.mergeGateRole, MERGE_GATE_ROLE)
			assert.equal(audit.workspaceAuditAtPreflight, true)
			assert.equal(audit.perLaneCompletionAudit[0]?.phase, "completion_gate")
			assert.ok(audit.storageBoundary.includes("subagent_executions"))
			assert.equal(audit.storageBoundary, AUDIT_STORAGE_BOUNDARY)
		})

		it("false-positive lock audit counts skipped locks without merge violations", () => {
			const laneReceipts = [
				{
					laneId: "l0",
					agentId: "a0",
					index: 0,
					status: "completed" as const,
					claimReleased: true,
					evidenceCount: 1,
					touchedFiles: [],
					sealedAt: Date.now(),
					executionMode: "read_only" as const,
					lockRequired: false,
				},
			]
			const mergeGate = runMergeGate({
				agents: [buildAgent("a0", 0)],
				laneReceipts,
				claimHistory: [],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				replayArtifact: {
					schema: "execution.replay/v1",
					artifactId: "swarm-int",
					source: "swarm",
					taskId: "task-1",
					status: "completed",
					startedAt: Date.now(),
					completedAt: Date.now(),
					lineage: [],
					timeline: [],
					checkpoints: [],
					artifactPointers: [],
					integrity: { valid: true, violations: [] },
					extension: {},
				},
				attemptId: "attempt-1",
			})

			const fp = auditFalsePositiveLocks(laneReceipts, mergeGate)
			assert.equal(fp.lockSkippedCount, 1)
			assert.equal(fp.missingLockViolations, 0)
		})
	})

	describe("seal receipt integration fields", () => {
		it("persists roadmapLinkage and auditIntegration on governed receipt", async () => {
			await setupStore()
			const coord = new GovernedSwarmCoordinator("/tmp", false, 1, undefined, new InMemoryLockAuthority(), "attempt-int")
			const admission = await coord.admitSwarm("parent", "subagent_swarm")
			const claim = await coord.acquireLane("swarm-int", "a0", 0, { executionMode: "read_only" })
			assert.ok(claim.claim)
			await coord.releaseLane(claim.claim, true)
			const laneReceipt = coord.buildLaneReceipt(claim.claim, buildAgent("a0", 0), "completed", true)
			const agents = [buildAgent("a0", 0)]
			const envelope = {
				swarmId: "swarm-int",
				executionId: "e1",
				taskId: "task-int",
				continuity: {
					swarmId: "swarm-int",
					taskId: "task-int",
					resumeToken: "t",
					lastPersistedAt: Date.now(),
					completedAgents: 1,
					totalAgents: 1,
					status: "completed" as const,
				},
				agents,
				blackboardSnapshot: [],
				timestamps: { started: Date.now(), completed: Date.now() },
				status: "completed" as const,
				invariants: { validated: true, violations: [] },
				artifactPath: "subagent_executions/swarm-int.json",
				schemaVersion: 1 as const,
			}

			const receipt = await coord.sealReceipt({
				taskId: "task-int",
				envelope,
				admission,
				laneReceipts: [laneReceipt],
				preflightIssues: [],
			})

			assert.ok(receipt.roadmapLinkage)
			assert.equal(receipt.roadmapLinkage?.roadmapEnabled, false)
			assert.ok(receipt.auditIntegration)
			assert.equal(receipt.auditIntegration?.mergeGateRole, MERGE_GATE_ROLE)
			assert.deepEqual(receipt.roadmapLinkage?.incompleteIntegration, ["roadmap_disabled"])
		})

		it("documents remaining partial roadmap integration when roadmap enabled", () => {
			assert.ok(ROADMAP_INTEGRATION_PARTIAL.includes("per_lane_scheduleAdmission_on_lock_acquire"))
			assert.ok(ROADMAP_INTEGRATION_PARTIAL.includes("roadmap_item_linkage_via_prompt_tags_only"))
		})
	})
})
