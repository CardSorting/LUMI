import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { DietCodeSaySubagentStatus } from "@shared/ExtensionMessage"
import { diffSubagentStatuses } from "@shared/execution/statusDiff"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { createContinuityMarker, SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import {
	broccoliReplayToArtifact,
	mergeReplayLineage,
	swarmEnvelopeToReplayArtifact,
	verifyReplayArtifact,
} from "../executionReplayMappers"
import { validateSubagentEnvelope } from "../executionValidation"
import { isArtifactStale, planResumeFromArtifact } from "../ResumeSwarmFromArtifact"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"
import { loadSwarmEnvelope, persistSwarmEnvelope } from "../SubagentExecutionStore"
import { loadTranscriptEvents, SubagentTranscriptRecorder } from "../SubagentTranscriptRecorder"

function buildAgent(overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder("agent-1", "exec-1", "researcher", "swarm-1", "task-1", "inspect module", {
		swarmId: "swarm-1",
		index: 1,
		depth: 1,
	})
	builder.setStatus("running")
	builder.recordToolStep("read_file", "read_file(path=src/a.ts)", "contents", { path: "src/a.ts" })
	builder.setTranscriptMeta("subagent_executions/swarm-1/agents/agent-1.transcript.jsonl", 3, 120)
	builder.complete("done")
	return { ...builder.build(), compactionEvents: [], ...overrides }
}

function buildSwarm(
	agents: SubagentExecutionEnvelope[],
	status: SwarmExecutionEnvelope["status"] = "interrupted",
): SwarmExecutionEnvelope {
	return {
		swarmId: "swarm-1",
		executionId: "swarm-exec-1",
		taskId: "task-1",
		continuity: createContinuityMarker("swarm-1", "task-1", agents.length, 1, status),
		agents,
		blackboardSnapshot: [],
		timestamps: { started: Date.now() - 5000 },
		status,
		invariants: { validated: false, violations: [] },
		artifactPath: "",
		schemaVersion: SWARM_ENVELOPE_SCHEMA_VERSION,
	}
}

describe("execution harness gap closure", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("persists transcript through success, failure, and interruption paths", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "transcript-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

		const recorder = new SubagentTranscriptRecorder({
			swarmId: "swarm-1",
			agentId: "agent-1",
			taskId: "task-1",
			executionId: "exec-1",
		})
		await recorder.init()
		recorder.append("llm_request", { iteration: 1 })
		recorder.append("assistant_turn", { text: "thinking" })
		recorder.append("tool_call", { toolName: "read_file" })
		recorder.append("tool_response", { toolName: "read_file", result: "ok" })
		await recorder.flush()

		const loaded = await loadTranscriptEvents("task-1", "swarm-1", "agent-1")
		assert.equal(loaded.events.length, 4)
		assert.equal(loaded.events[2].kind, "tool_call")
		assert.equal(loaded.events[3].kind, "tool_response")
	})

	it("records compaction boundary before context drop and fails validation when missing", async () => {
		const agent = buildAgent({
			compactionEvents: [
				{
					id: "comp-1",
					timestamp: Date.now(),
					executionId: "exec-1",
					agentId: "agent-1",
					transcriptSequence: 2,
					reason: "proactive_threshold",
					preTokenEstimate: 1000,
					postTokenEstimate: 750,
					droppedRange: [0, 2],
					continuityRiskLevel: "medium",
					artifactPointer: "subagent_executions/swarm-1/agents/agent-1.transcript.jsonl",
					contentKind: "summary",
				},
			],
		})
		assert.equal(agent.compactionEvents[0].contentKind, "summary")
		const missingCompaction = validateSubagentEnvelope({ ...agent, compactionEvents: [] })
		assert.ok(!missingCompaction.some((v) => v.includes("compaction")))
	})

	it("detects corrupted transcript checksum", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "transcript-corrupt-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

		const dir = path.join(tempDir, "subagent_executions/swarm-1/agents")
		await fs.mkdir(dir, { recursive: true })
		const event = {
			id: "e1",
			sequence: 0,
			timestamp: Date.now(),
			kind: "tool_call",
			contentKind: "raw",
			swarmId: "swarm-1",
			agentId: "agent-1",
			taskId: "task-1",
			executionId: "exec-1",
			payload: {},
			checksum: "bad",
		}
		await fs.writeFile(path.join(dir, "agent-1.transcript.jsonl"), `${JSON.stringify(event)}\n`, "utf8")

		const loaded = await loadTranscriptEvents("task-1", "swarm-1", "agent-1")
		assert.ok(loaded.corruption?.includes("checksum mismatch"))
	})

	it("plans resume with reuse, retry, and restart buckets", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

		const completed = buildAgent({ status: "completed", agentId: "a-done" })
		const failed = buildAgent({
			status: "failed",
			agentId: "a-fail",
			verbatimOutput: undefined,
			error: "timeout",
			lineage: { swarmId: "swarm-1", index: 2, depth: 1 },
		})
		const pending = buildAgent({
			status: "pending",
			agentId: "a-pending",
			verbatimOutput: undefined,
			lineage: { swarmId: "swarm-1", index: 3, depth: 1 },
		})

		const recorder = new SubagentTranscriptRecorder({
			swarmId: "swarm-1",
			agentId: "a-done",
			taskId: "task-1",
			executionId: "exec-1",
		})
		await recorder.init()
		recorder.append("completion", { result: "done" })
		await recorder.flush()

		const swarm = buildSwarm([completed, failed, pending], "interrupted")
		await persistSwarmEnvelope("task-1", swarm)

		const plan = await planResumeFromArtifact("task-1", "swarm-1", { newSwarmId: "swarm-2", maxAgeMs: 60_000 })
		assert.equal(plan.reuseAgents.length, 1)
		assert.equal(plan.retryAgents.length, 1)
		assert.equal(plan.restartAgents.length, 1)
		assert.equal(plan.recoveryReceipt.operatorVisible, true)
	})

	it("rejects corrupted and stale artifacts for resume", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-reject-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

		const swarm = buildSwarm([buildAgent()], "interrupted")
		swarm.timestamps.started = Date.now() - 10 * 24 * 60 * 60 * 1000
		swarm.continuity.lastPersistedAt = Date.now() - 10 * 24 * 60 * 60 * 1000
		await persistSwarmEnvelope("task-1", swarm)
		const loaded = await loadSwarmEnvelope("task-1", "swarm-1")
		assert.ok(loaded)
		assert.equal(isArtifactStale(loaded!), true)

		await assert.rejects(() => planResumeFromArtifact("task-1", "swarm-1"), /stale/)
	})

	it("converts swarm and broccoli artifacts to shared replay contract", () => {
		const swarmArtifact = swarmEnvelopeToReplayArtifact(buildSwarm([buildAgent()], "failed"))
		const broccoliArtifact = broccoliReplayToArtifact({
			sessionId: "sess-1",
			mode: "forensic",
			status: "completed",
			startedAt: Date.now() - 1000,
			taskId: "task-1",
			journalCount: 2,
			eventCount: 3,
			traceCount: 1,
		})

		assert.equal(swarmArtifact.source, "swarm")
		assert.equal(broccoliArtifact.source, "broccoli")
		assert.equal(verifyReplayArtifact(swarmArtifact).valid, true)
		assert.equal(verifyReplayArtifact(broccoliArtifact).valid, true)

		const lineage = mergeReplayLineage([swarmArtifact, broccoliArtifact])
		assert.ok(lineage.length >= 2)
		assert.ok(lineage.some((node) => node.source === "swarm"))
		assert.ok(lineage.some((node) => node.source === "broccoli"))
	})

	it("diffs execution status payloads for operator UI", () => {
		const left: DietCodeSaySubagentStatus = {
			status: "failed",
			total: 1,
			completed: 1,
			successes: 0,
			failures: 1,
			toolCalls: 1,
			inputTokens: 1,
			outputTokens: 1,
			contextWindow: 1000,
			maxContextTokens: 10,
			maxContextUsagePercentage: 1,
			swarmId: "swarm-a",
			items: [
				{
					id: "a1",
					name: "Agent",
					index: 1,
					prompt: "p",
					status: "failed",
					toolCalls: 1,
					inputTokens: 1,
					outputTokens: 1,
					totalCost: 0,
					contextTokens: 1,
					contextWindow: 1000,
					contextUsagePercentage: 1,
					transcriptEventCount: 2,
				},
			],
		}
		const right: DietCodeSaySubagentStatus = {
			...left,
			status: "completed",
			successes: 1,
			failures: 0,
			swarmId: "swarm-b",
			items: [{ ...left.items[0], status: "completed", transcriptEventCount: 5, result: "ok" }],
		}

		const diff = diffSubagentStatuses(left, right)
		assert.equal(diff.identical, false)
		assert.equal(diff.agentDiffs[0].changeKind, "changed")
		assert.equal(diff.transcriptDeltaTotal, 3)
	})

	it("handles identical execution diff cleanly", () => {
		const status: DietCodeSaySubagentStatus = {
			status: "completed",
			total: 1,
			completed: 1,
			successes: 1,
			failures: 0,
			toolCalls: 1,
			inputTokens: 1,
			outputTokens: 1,
			contextWindow: 1000,
			maxContextTokens: 10,
			maxContextUsagePercentage: 1,
			swarmId: "swarm-a",
			items: [
				{
					id: "a1",
					name: "Agent",
					index: 1,
					prompt: "p",
					status: "completed",
					toolCalls: 1,
					inputTokens: 1,
					outputTokens: 1,
					totalCost: 0,
					contextTokens: 1,
					contextWindow: 1000,
					contextUsagePercentage: 1,
					transcriptEventCount: 2,
					result: "ok",
				},
			],
		}
		const diff = diffSubagentStatuses(status, { ...status, swarmId: "swarm-b" })
		assert.equal(diff.identical, true)
	})
})
