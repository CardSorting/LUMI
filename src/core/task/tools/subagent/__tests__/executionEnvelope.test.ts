import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { CompletionFunnelEvent } from "@shared/completion/completionFunnelEvent"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { createContinuityMarker } from "@shared/subagent/executionEnvelope"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { assertSwarmEnvelopeOrThrow, validateSwarmEnvelope } from "../executionValidation"
import { SWARM_TERMINAL_STAGING_VIOLATION, validateArtifactIntegrity } from "../ResumeSwarmFromArtifact"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"
import {
	listSwarmEnvelopeIds,
	loadSwarmEnvelope,
	persistSwarmEnvelope,
	reconstructSwarmFromArtifact,
} from "../SubagentExecutionStore"
import { buildParentToolResult, buildSwarmSummaryOverlay } from "../SwarmReportBuilder"

function createAgentEnvelope(overrides?: Partial<SubagentExecutionEnvelope>): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(
		"agent-1",
		"exec-1",
		"researcher",
		"swarm-1",
		"task-1",
		"inspect auth module",
		{ swarmId: "swarm-1", index: 1, depth: 1 },
		"stream-parent",
		"stream-child",
	)
	builder.setStatus("running")
	builder.recordToolStep("read_file", "read_file(path=src/auth.ts)", "file contents here", { path: "src/auth.ts" })
	builder.complete(`${"Auth module uses JWT with refresh rotation. ".repeat(20)}End.`)
	return { ...builder.build(), compactionEvents: [], ...overrides }
}

function createSwarmEnvelope(agents: SubagentExecutionEnvelope[]): SwarmExecutionEnvelope {
	return {
		swarmId: "swarm-1",
		executionId: "swarm-exec-1",
		taskId: "task-1",
		parentStreamId: "stream-parent",
		continuity: createContinuityMarker("swarm-1", "task-1", agents.length, agents.length, "completed"),
		agents,
		blackboardSnapshot: ["shared finding"],
		timestamps: { started: Date.now() - 1000, completed: Date.now() },
		status: "completed",
		invariants: { validated: false, violations: [] },
		artifactPath: "",
		schemaVersion: 1,
	}
}

describe("subagent execution envelope", () => {
	let tempDir: string

	afterEach(async () => {
		sinon.restore()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("preserves verbatim output through aggregation overlays", () => {
		const agent = createAgentEnvelope()
		const swarm = createSwarmEnvelope([agent])
		const entries = [
			{
				id: agent.agentId,
				name: agent.role,
				index: 1,
				prompt: agent.prompt,
				status: "completed" as const,
				toolCalls: 1,
				inputTokens: 1,
				outputTokens: 1,
				totalCost: 0,
				contextTokens: 1,
				contextWindow: 1000,
				contextUsagePercentage: 0.1,
				result: agent.verbatimOutput,
			},
		]

		const overlay = buildSwarmSummaryOverlay(swarm, entries)
		const parentResult = buildParentToolResult(swarm, overlay)
		const verbatimOutput = agent.verbatimOutput

		assert.ok(verbatimOutput)
		assert.ok(overlay.includes("excerpted for context window"))
		assert.ok(parentResult.includes(verbatimOutput.slice(0, 20)))
		assert.ok(verbatimOutput.length > 300)
		assert.ok(!overlay.includes(verbatimOutput))
		assert.equal(agent.evidenceRefs.length > 0, true)
	})

	it("rejects malformed completed swarm reports without verbatim output", () => {
		const agent = createAgentEnvelope({ verbatimOutput: "", status: "completed" })
		const report = validateSwarmEnvelope(createSwarmEnvelope([agent]))
		assert.equal(report.validated, false)
		assert.ok(report.violations.some((violation) => violation.includes("verbatim output")))
	})

	it("keeps missing evidence and transcript pointers advisory", () => {
		const agent = createAgentEnvelope({ evidenceRefs: [], transcriptArtifactPath: undefined })
		const report = validateSwarmEnvelope(createSwarmEnvelope([agent]))

		assert.equal(report.validated, true)
		assert.equal(report.violations.length, 0)
		assert.ok(report.advisoryWarnings?.some((warning) => warning.includes("missing evidence references")))
		assert.ok(report.advisoryWarnings?.some((warning) => warning.includes("missing transcript artifact path")))
	})

	it("rejects orphaned subtasks when swarm is marked completed", () => {
		const completed = createAgentEnvelope()
		const pending = createAgentEnvelope({ agentId: "agent-2", status: "pending", verbatimOutput: undefined })
		const report = validateSwarmEnvelope(createSwarmEnvelope([completed, pending]))
		assert.ok(report.violations.some((violation) => violation.includes("orphaned subtasks")))
	})

	it("persists and reconstructs replay artifacts", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-exec-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)

		const swarm = createSwarmEnvelope([createAgentEnvelope()])
		const artifactPath = await persistSwarmEnvelope("task-1", swarm)
		assert.ok(artifactPath.replaceAll("\\", "/").includes("subagent_executions/swarm-1.json"))

		const reconstructed = await reconstructSwarmFromArtifact("task-1", "swarm-1")
		assert.equal(reconstructed.agents[0].verbatimOutput, swarm.agents[0].verbatimOutput)
		assert.equal(reconstructed.agents[0].toolSteps.length, 1)

		const ids = await listSwarmEnvelopeIds("task-1")
		assert.deepEqual(ids, ["swarm-1"])

		const loaded = await loadSwarmEnvelope("task-1", "swarm-1")
		assert.ok(loaded)
		assert.equal(loaded.invariants.validated, validateSwarmEnvelope(loaded).validated)
	})

	it("atomically preserves invocation order and caller-declared terminal violations", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-exec-order-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
		const swarm = createSwarmEnvelope([createAgentEnvelope()])

		await Promise.all(
			Array.from({ length: 20 }, (_, revision) =>
				persistSwarmEnvelope("task-ordered", {
					...swarm,
					summaryOverlay: `revision-${revision}`,
					invariants: {
						validated: false,
						violations: revision === 19 ? ["merge blocked at terminal barrier"] : [],
					},
				}),
			),
		)

		const loaded = await loadSwarmEnvelope("task-ordered", swarm.swarmId)
		assert.equal(loaded?.summaryOverlay, "revision-19")
		assert.ok(loaded?.invariants.violations.includes("merge blocked at terminal barrier"))
		const artifactDir = path.join(tempDir, "subagent_executions")
		assert.deepEqual(await fs.readdir(artifactDir), [`${swarm.swarmId}.json`])
	})

	it("rejects a staged terminal artifact before its governed receipt is sealed", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-exec-staging-"))
		const disk = await import("@core/storage/disk")
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
		const swarm = createSwarmEnvelope([createAgentEnvelope()])
		swarm.invariants.violations.push(SWARM_TERMINAL_STAGING_VIOLATION)
		await persistSwarmEnvelope("task-1", swarm)

		const loaded = await loadSwarmEnvelope("task-1", swarm.swarmId)
		assert.ok(loaded)
		const integrity = await validateArtifactIntegrity("task-1", loaded)
		assert.ok(integrity.violations.includes(SWARM_TERMINAL_STAGING_VIOLATION))
	})

	it("fails closed on invariant violations when asserted", () => {
		const swarm = createSwarmEnvelope([])
		assert.throws(() => assertSwarmEnvelopeOrThrow(swarm), /Swarm envelope invariant violation/)
	})

	it("preserves gate lifecycle snapshot on completion gate phase", () => {
		const builder = new SubagentEnvelopeBuilder(
			"agent-gate",
			"exec-gate",
			"researcher",
			"swarm-1",
			"task-1",
			"verify module",
			{ swarmId: "swarm-1", index: 1, depth: 1 },
		)
		const completionFunnelEvent: CompletionFunnelEvent = {
			schemaVersion: 1,
			taskId: "task-1",
			phase: "blocked",
			kind: "soft_block",
			terminal: false,
			nextAllowedAction: "modify_workspace",
			forbiddenActions: ["attempt_completion"],
			canonicalInstruction: "Fix audit violations before completing.",
			reason: "Audit blocked.",
			stages: [],
			graphRevision: 1,
			evaluatedAt: Date.now(),
		}
		builder.setPhase("completion_gate")
		builder.recordCompletionFunnel(completionFunnelEvent)
		builder.recordBlocker("audit gate blocked")
		const envelope = builder.build()
		assert.equal(envelope.completionFunnelEvent?.phase, "blocked")
		assert.equal(envelope.phase, "completion_gate")
		assert.ok(envelope.blockers.length > 0)
	})
})
