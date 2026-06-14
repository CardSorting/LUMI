import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { evaluateRoadmapCompletionBlock, requireFreshCheckpointBeforeComplete } from "../RoadmapCompletionGate"
import { gateClosedEnvelope, validationPendingEnvelope } from "../RoadmapErrors"
import { preflightRoadmapWrite, validateRoadmapWriteTarget } from "../RoadmapNativeBridge"
import { formatProgressReport } from "../RoadmapProgress"
import { RoadmapService } from "../RoadmapService"
import { buildSteeringContext, enrichPayloadWithSteering } from "../RoadmapSteeringContext"

describe("RoadmapIntegration", () => {
	it("rejects ROADMAP writes outside workspace root", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-int-"))
		try {
			const reject = await validateRoadmapWriteTarget("/tmp/other/ROADMAP.md", tmp)
			assert.strictEqual(reject.allowed, false)
			const preflight = await preflightRoadmapWrite("write_to_file", { path: "../ROADMAP.md" }, tmp)
			assert.strictEqual(preflight.block, true)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("blocks completion when validation_pending", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-int-"))
		try {
			await fs.mkdir(path.join(tmp, ".dietcode"), { recursive: true })
			await fs.writeFile(
				path.join(tmp, ".dietcode", "roadmap-state.json"),
				JSON.stringify({ validation_pending: true }),
				"utf8",
			)
			await fs.writeFile(path.join(tmp, "ROADMAP.md"), "# Test\n", "utf8")

			const block = await evaluateRoadmapCompletionBlock(tmp)
			assert.strictEqual(block.blocked, true)
			assert.match(block.message || "", /validate/i)

			const kernelBlock = await requireFreshCheckpointBeforeComplete(tmp)
			assert.ok(kernelBlock)
			assert.match(kernelBlock, /validate|explain-gate/i)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("enriches payloads with steering context", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-int-"))
		try {
			await fs.writeFile(path.join(tmp, "README.md"), "# Integration Project\n\nSteering test.\n", "utf8")
			const steering = await buildSteeringContext(tmp)
			assert.strictEqual(steering.workspace, tmp)
			assert.ok(steering.roadmap_path)

			const enriched = await enrichPayloadWithSteering({ action: "guide", workspace: tmp })
			assert.strictEqual(enriched.workspace, tmp)
			assert.ok(enriched.agent_next_call)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("formats progress report with timeline footer", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-int-"))
		try {
			const snap = await import("../RoadmapProgress").then((m) => m.buildProgressSnapshot(tmp))
			const report = await formatProgressReport({ workspace: tmp, timeline: true, snapshot: snap })
			assert.match(report, /Roadmap progress|idle/)
			assert.match(report, /explain-gate/)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("returns normalized error envelopes with slash diagnostics", () => {
		const pending = validationPendingEnvelope("/tmp/project")
		assert.strictEqual(pending.string_code, "validation_pending")
		assert.match(pending.diagnostic_command, /^\/roadmap/)
		assert.match(pending.suggested_slash_command, /validate/)

		const gate = gateClosedEnvelope("Schema gate closed")
		assert.strictEqual(gate.string_code, "gate_closed")
		assert.match(gate.diagnostic_command, /explain-gate/)
	})
})

describe("RoadmapService progress snapshot", () => {
	it("returns recent_events in progress snapshot", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-int-"))
		try {
			const service = RoadmapService.getInstance()
			const snapshot = await service.getProgressSnapshot(tmp, "--current")
			assert.ok(Array.isArray(snapshot.recent_events) || snapshot.current != null || snapshot.report)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})
